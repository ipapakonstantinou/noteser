import { v4 as uuid } from 'uuid'
import { useNoteStore, useFolderStore, useGitHubStore, useSettingsStore } from '@/stores'
import type { Note } from '@/types'
import type { PullClassification } from './githubSync'
import { parseNote, serializeNote, takeZipballAttachmentBytes } from './githubSync'
import { putAttachmentAtPath } from './attachments'
import { getBlobBytes, gitBlobSha } from './github'

// ── Folder + tag find-or-create helpers ─────────────────────────────────────

// Delegate to folderStore — the action there is the canonical implementation
// (used by attachments.ts too, so attachment drops materialise their parent).
function ensureFolderPath(segments: string[]): string | null {
  return useFolderStore.getState().ensureFolderPath(segments)
}

// Tags from frontmatter are merged into the body as `#tag` so they survive
// in the derived-tags model.
export function bodyWithInlineTags(body: string, frontmatterTags: string[]): string {
  if (frontmatterTags.length === 0) return body
  const prefix = frontmatterTags.map(t => `#${t}`).join(' ')
  // Don't add a duplicate prefix if the body already starts with it (rare,
  // but happens on round-trips between Noteser versions).
  if (body.startsWith(prefix)) return body
  return `${prefix}\n\n${body}`
}

// Parse a repo path like "Work/Q1 plan.md" → ({ segments: ['Work'], title: 'Q1 plan' }).
function splitRepoPath(path: string): { segments: string[]; title: string } {
  const parts = path.split('/')
  const file = parts.pop() ?? ''
  const title = file.endsWith('.md') ? file.slice(0, -3) : file
  return { segments: parts, title }
}

// ── Apply ──────────────────────────────────────────────────────────────────

export interface ApplyCounts {
  created: number
  updated: number
  deleted: number
  // Subset of `updated`: how many were the result of a successful line-level
  // 3-way auto-merge (as opposed to a clean one-sided remote update). Surfaced
  // separately so the sync status line can highlight it.
  autoMerged: number
}

// Local-canonical blob SHA for the bytes we're about to STORE. We pin
// gitLastPushedSha to this — NOT to the raw remote blob SHA — because a remote
// `.md` with frontmatter is stored in a transformed form (frontmatter stripped,
// tags inlined). serializeNote/normalizeForPush is the exact same canonicaliser
// the push path uses, so the SHA matches what a clean re-push would produce and
// the next pull classifies the untouched note as `unchanged`. See the
// two-SHA-split fix in src/types/index.ts (Note.gitRemoteBaseSha).
function canonicalLocalSha(content: string): Promise<string> {
  return gitBlobSha(serializeNote({ content } as Note))
}

export async function applyNonConflicts(classifications: PullClassification[]): Promise<ApplyCounts> {
  const counts: ApplyCounts = { created: 0, updated: 0, deleted: 0, autoMerged: 0 }

  // Build the FINAL notes array in memory in a single pass, then write
  // it via one setState call at the end. The previous implementation
  // called addNote/updateNote/deleteNote N times — each set() triggered
  // a full IDB write of the notes array, so pulling a 200-note vault
  // for the first time was O(N²) memory + caused Chrome to pause with
  // "potential out-of-memory crash" at idbStorage.setItem. Batching
  // makes it O(N) — one IDB write per sync.
  const noteState = useNoteStore.getState()
  const now = Date.now()
  // Index existing notes by id for O(1) updates.
  const byId = new Map(noteState.notes.map(n => [n.id, n]))
  let lastCreatedId: string | null = null

  for (const c of classifications) {
    if (c.kind === 'unchanged' || c.kind === 'conflict' || c.kind === 'conflictDeleted') continue
    // Attachment classifications are handled asynchronously by
    // applyAttachmentClassifications — the binary fetch + IDB write doesn't
    // belong in this synchronous note-store loop. Skip here.
    if (c.kind === 'attachmentCreated' || c.kind === 'attachmentUpdated') continue

    if (c.kind === 'folderCreated') {
      // ensureFolderPath has its own batching concern but we don't
      // re-implement that here — folder creation is rare relative to
      // notes, and the folderStore set() already coalesces in practice.
      ensureFolderPath(c.path.split('/'))
      continue
    }

    if (c.kind === 'vaultSettingsUpdated') {
      // The store's applyRemoteVaultSettings handles whitelisting (only
      // VAULT_SETTING_KEYS are accepted) so we can pass the parsed
      // payload through directly. Hash + remoteUpdatedAt go in too so
      // the next push knows we already have this version.
      useSettingsStore.getState().applyRemoteVaultSettings(
        c.remoteVault as Partial<ReturnType<typeof useSettingsStore.getState>>,
        c.remoteUpdatedAt,
        c.remoteHash,
      )
      counts.updated++
      continue
    }

    if (c.kind === 'vaultSettingsConflict') {
      // vs8x-conflict: open the merge modal with both sides + the
      // differing keys. The user picks per-key + clicks Apply to
      // write the resolution. Until they do, the LOCAL settings
      // stay intact so we never silently clobber unsynced edits.
      const { useUIStore } = require('@/stores/uiStore') as typeof import('@/stores/uiStore')
      useUIStore.getState().openModal({
        type: 'vault-settings-conflict',
        data: {
          remoteUpdatedAt: c.remoteUpdatedAt,
          remoteHash: c.remoteHash,
          remoteVault: c.remoteVault,
          localVault: c.localVault,
          diffKeys: c.diffKeys,
        },
      })
      // Not counted as updated — it's pending the user's resolution.
      continue
    }

    if (c.kind === 'remoteCreated') {
      const { segments, title } = splitRepoPath(c.path)
      const folderId = ensureFolderPath(segments)
      const content = bodyWithInlineTags(c.body, c.tags)
      const newNote = {
        id: uuid(),
        title,
        content,
        folderId,
        gitPath: c.path,
        // localChanged baseline: SHA of the canonical LOCAL bytes we just
        // stored (transformed body), so an untouched note round-trips to
        // `unchanged` on the next pull.
        gitLastPushedSha: await canonicalLocalSha(content),
        // Merge ancestor: the actual remote blob SHA, fetchable via
        // getBlobContent. Distinct from gitLastPushedSha for frontmatter notes.
        gitRemoteBaseSha: c.remoteSha,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      }
      byId.set(newNote.id, newNote as ReturnType<typeof useNoteStore.getState>['notes'][number])
      lastCreatedId = newNote.id
      counts.created++
      continue
    }

    if (c.kind === 'remoteUpdated') {
      const existing = byId.get(c.noteId)
      if (!existing) continue
      const content = bodyWithInlineTags(c.body, c.tags)
      byId.set(c.noteId, {
        ...existing,
        content,
        gitLastPushedSha: await canonicalLocalSha(content),
        gitRemoteBaseSha: c.remoteSha,
        updatedAt: now,
      })
      counts.updated++
      continue
    }

    if (c.kind === 'autoMerged') {
      const existing = byId.get(c.noteId)
      if (!existing) continue
      byId.set(c.noteId, {
        ...existing,
        content: c.mergedContent,
        // The merged bytes are the new local content; pin the baseline to
        // their canonical SHA. The remote base stays the remote SHA we merged
        // against — the next push will upload the union edit and re-coincide
        // the two SHAs.
        gitLastPushedSha: await canonicalLocalSha(c.mergedContent),
        gitRemoteBaseSha: c.remoteSha,
        updatedAt: now,
      })
      counts.updated++
      counts.autoMerged++
      continue
    }

    if (c.kind === 'remoteDeleted') {
      // Soft-delete (matches the standalone deleteNote path for 'trash'
      // mode). hardDelete mode users want immediate removal — but pulling
      // SHOULD route through the trash for safety regardless of the
      // setting; the data only came from the remote.
      const existing = byId.get(c.noteId)
      if (!existing) continue
      byId.set(c.noteId, {
        ...existing,
        isDeleted: true,
        deletedAt: now,
      })
      counts.deleted++
      continue
    }
  }

  // Single set() — one IDB write for the whole pull.
  useNoteStore.setState({
    notes: Array.from(byId.values()),
    // Preserve selectedNoteId; only update if the user had nothing
    // selected and we just imported their first note.
    selectedNoteId: noteState.selectedNoteId ?? lastCreatedId,
  })

  return counts
}

// Used by the new merge-editor flow: the user produced a merged body of the
// note (line-by-line cherry pick). We store it as the note's content and pin
// the SHAs so pull doesn't see this as a conflict again — push will upload the
// merged content on the next sync.
//
// We set gitRemoteBaseSha = c.remoteSha so the next pull sees remoteChanged =
// false (the remote blob we resolved against is still the latest). We leave
// gitLastPushedSha = c.remoteSha (the RAW remote SHA) rather than the canonical
// local SHA: that mismatch is intentional here — it makes localChanged = true
// so the resolution gets pushed. Next push then re-coincides both SHAs to the
// pushed blob. (No async hash needed: a deliberate mismatch is all we want.)
export function applyMergedConflict(
  c: Extract<PullClassification, { kind: 'conflict' }>,
  mergedRawFile: string,
): void {
  const { updateNote } = useNoteStore.getState()
  // The diff was on the raw file content (possibly with legacy frontmatter).
  // Re-parse to strip any tags block; merge those tags into the body.
  const parsed = parseNote(mergedRawFile)
  updateNote(c.noteId, {
    content: bodyWithInlineTags(parsed.body, parsed.tags),
    gitLastPushedSha: c.remoteSha,
    gitRemoteBaseSha: c.remoteSha,
  })
}

// Used by the conflict resolver. Critical invariant: after we apply, the next
// pull must NOT classify this note as a conflict again.
//
// For a regular conflict we set gitRemoteBaseSha to the *remote* SHA we saw at
// conflict time (so the next pull computes remoteChanged = false) and keep
// gitLastPushedSha at that same remote SHA. With the two-SHA classifier the
// next pull evaluates as:
//   gitRemoteBaseSha === remoteSha           → remoteChanged = false
//   gitLastPushedSha !== canonicalLocalSha   → localChanged  = true
// → push-only, no conflict. The push then re-coincides both SHAs.
//
// For a conflictDeleted we clear gitPath + both SHAs so the note is treated
// like a fresh local note: push will create the file from scratch.
export function applyConflictResolution(
  c: Extract<PullClassification, { kind: 'conflict' } | { kind: 'conflictDeleted' }>,
  choice: 'local' | 'remote',
): void {
  const { updateNote, deleteNote } = useNoteStore.getState()
  if (c.kind === 'conflict') {
    if (choice === 'remote') {
      updateNote(c.noteId, {
        content: bodyWithInlineTags(c.remoteBody, c.remoteTags),
        gitLastPushedSha: c.remoteSha,
        gitRemoteBaseSha: c.remoteSha,
      })
    } else {
      updateNote(c.noteId, { gitLastPushedSha: c.remoteSha, gitRemoteBaseSha: c.remoteSha })
    }
  } else {
    // conflictDeleted: remote file is gone, but local has unsynced edits.
    if (choice === 'remote') {
      deleteNote(c.noteId)
    } else {
      // Re-spawn: drop the stale path/SHAs so push treats it as a new file.
      updateNote(c.noteId, { gitPath: null, gitLastPushedSha: null, gitRemoteBaseSha: null })
    }
  }
}

// ── Attachment classifications ──────────────────────────────────────────────
// Pulled binary attachments are saved into IDB at their repo path so the
// existing AttachmentImage / attachments.ts read-path can resolve them
// transparently. Bytes come from one of two sources, in priority order:
//   1. takeZipballAttachmentBytes (cached during pullFromZipball — no API call)
//   2. getBlobBytes (per-blob fetch — used by the incremental pull)
//
// Errors fetching a single attachment are logged and skipped; we don't want
// one missing image to abort the entire sync.

export interface AttachmentApplyCounts {
  created: number
  updated: number
  failed: number
}

export async function applyAttachmentClassifications(
  classifications: PullClassification[],
): Promise<AttachmentApplyCounts> {
  const counts: AttachmentApplyCounts = { created: 0, updated: 0, failed: 0 }

  // We need the token + repo to fetch blobs not already cached by the zipball
  // path. Pull these once from the github store; bail out if either is unset
  // (caller shouldn't have classified anything as an attachment without them).
  const { token, syncRepo } = useGitHubStore.getState()

  for (const c of classifications) {
    if (c.kind !== 'attachmentCreated' && c.kind !== 'attachmentUpdated') continue
    try {
      // Prefer the bytes already in memory from a zipball pull.
      const cached = takeZipballAttachmentBytes(c.path)
      let bytes: Uint8Array
      let mime: string
      if (cached) {
        bytes = cached.bytes
        mime = cached.mime
      } else {
        if (!token || !syncRepo) throw new Error('No token / repo for incremental attachment fetch')
        bytes = await getBlobBytes(token, syncRepo.owner, syncRepo.name, c.remoteSha)
        mime = c.mime
      }
      // `.slice()` detaches from any SharedArrayBuffer typing so the Blob
      // constructor accepts the bytes as a BlobPart on strict TS configs.
      const blob = new Blob([bytes.slice()], { type: mime })
      await putAttachmentAtPath(c.path, blob)
      if (c.kind === 'attachmentCreated') counts.created++
      else counts.updated++
    } catch (err) {
      console.error(`Failed to apply attachment ${c.path}:`, err)
      counts.failed++
    }
  }

  return counts
}
