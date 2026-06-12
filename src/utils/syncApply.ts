import { v4 as uuid } from 'uuid'
import { useNoteStore, useFolderStore, useGitHubStore, useSettingsStore } from '@/stores'
import type { Note } from '@/types'
import type { PullClassification } from './githubSync'
import { parseNote, serializeNote, takeZipballAttachmentBytes } from './githubSync'
import { pickVaultSlice, serializeVaultSettings, vaultSettingsHash } from './vaultSettings'
import { putAttachmentAtPath } from './attachments'
import { getBlobBytes, gitBlobSha } from './github'
import { mapWithConcurrency, DEFAULT_CONCURRENCY } from './concurrency'

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

// Same as splitRepoPath but preserves the extension in `title` — foreign vault
// files surface with their full filename ("Untitled 1.canvas") so the user can
// see what type of file the entry is at a glance.
function splitRepoForeignPath(path: string): { segments: string[]; title: string } {
  const parts = path.split('/')
  const file = parts.pop() ?? ''
  return { segments: parts, title: file }
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
// `collabId` MUST be threaded in when the stored note will carry one: a note
// with a collabId serializes WITH a `collabId:` frontmatter block, so its
// canonical SHA differs from the body-only form. Omitting it here would pin a
// baseline that never matches serializeNote(note) → the next pull would read a
// phantom local edit and re-push every sync (churn). Undefined collabId keeps
// the exact body-only behaviour for the overwhelming majority of notes.
function canonicalLocalSha(content: string, collabId?: string): Promise<string> {
  return gitBlobSha(serializeNote({ content, collabId } as Note))
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
    // pull-dedupe-by-path: an `unchanged` classification carrying `adoptPath`
    // is a reconciled UNLINKED local note — the content matched the remote
    // byte-for-byte, but the note had no gitPath pointing at this file yet.
    // Link the gitPath here so the next pull keys it normally (and so push
    // doesn't re-create the file). This is the only `unchanged` case that
    // mutates a note; everything else is a genuine no-op.
    if (c.kind === 'unchanged') {
      if (c.adoptPath) {
        const existing = byId.get(c.noteId)
        if (existing && existing.gitPath !== c.adoptPath) {
          byId.set(c.noteId, { ...existing, gitPath: c.adoptPath })
        }
      }
      continue
    }
    if (c.kind === 'conflict' || c.kind === 'conflictDeleted') continue
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

    if (c.kind === 'foreignFile') {
      // Foreign vault file (non-md, non-attachment). We materialise a
      // placeholder Note with `kind: 'foreign'` so the file appears in the
      // sidebar tree as an un-openable entry, mirroring the remote vault
      // layout. The body is intentionally empty — canvas / base files can be
      // megabytes and we have no renderer for them yet. The push pipeline
      // (`syncPush.ts`) skips foreign notes so this mirror can never overwrite
      // the real remote file with empty bytes; the editor likewise refuses to
      // open them. See Note.kind in `src/types/index.ts`.
      const { segments, title } = splitRepoForeignPath(c.path)
      const folderId = ensureFolderPath(segments)
      const foreignNote = {
        id: uuid(),
        title,
        content: '',
        folderId,
        gitPath: c.path,
        // Pin both SHAs to the raw remote blob SHA so the classifier reads
        // the entry as `unchanged` on subsequent pulls and never re-emits a
        // foreignFile for it.
        gitLastPushedSha: c.remoteSha,
        gitRemoteBaseSha: c.remoteSha,
        kind: 'foreign' as const,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      }
      byId.set(foreignNote.id, foreignNote as ReturnType<typeof useNoteStore.getState>['notes'][number])
      counts.created++
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
      // Re-seed the push baseline to the CANONICAL hash of the APPLIED slice
      // (exactly what the push serializes via pickVaultSlice), NOT the raw
      // remote bytes. Otherwise a remote settings.json that is equivalent but
      // not byte-identical (older formatting, a key this client fills with a
      // default, a different client version) re-pushes on every clean clone.
      // Mirrors the note baseline = canonicalLocalSha, not the raw remote SHA.
      {
        const s = useSettingsStore.getState()
        const canonical = vaultSettingsHash(serializeVaultSettings(pickVaultSlice(s), c.remoteUpdatedAt))
        s.setVaultSettingsLastPushedHash(canonical)
      }
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

      // progressive-clone: a SHELL remoteCreated (first clone) materialises a
      // placeholder note — title + path from the tree, EMPTY body, contentLoaded
      // false. CRITICALLY both gitLastPushedSha AND gitRemoteBaseSha are pinned
      // to the RAW remote blob SHA (c.remoteSha), NOT to a canonical-of-empty
      // SHA. That is what makes the classifier read the shell as `unchanged`
      // (remoteBase === remoteSha) and guarantees it can never be pushed as an
      // empty-body overwrite before its real body loads. The background fill /
      // on-open path replaces content + re-pins gitLastPushedSha to the
      // canonical-local SHA and flips contentLoaded true.
      if (c.shell) {
        const shell = {
          id: uuid(),
          title,
          content: '',
          folderId,
          gitPath: c.path,
          gitLastPushedSha: c.remoteSha,
          gitRemoteBaseSha: c.remoteSha,
          contentLoaded: false,
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
          deletedAt: null,
          isPinned: false,
          templateId: null,
        }
        byId.set(shell.id, shell as ReturnType<typeof useNoteStore.getState>['notes'][number])
        lastCreatedId = shell.id
        counts.created++
        continue
      }

      const content = bodyWithInlineTags(c.body, c.tags)
      const newNote = {
        id: uuid(),
        title,
        content,
        folderId,
        gitPath: c.path,
        // Feature B: adopt the room id parsed from the remote frontmatter (if
        // any) so a client cloning the same vault joins the same live-collab
        // room. Undefined for the common (non-collab) note.
        ...(c.collabId ? { collabId: c.collabId } : {}),
        // localChanged baseline: SHA of the canonical LOCAL bytes we just
        // stored (transformed body + collabId frontmatter, if present), so an
        // untouched note round-trips to `unchanged` on the next pull.
        gitLastPushedSha: await canonicalLocalSha(content, c.collabId),
        // Merge ancestor: the actual remote blob SHA, fetchable via
        // getBlobContent. Distinct from gitLastPushedSha for frontmatter notes.
        gitRemoteBaseSha: c.remoteSha,
        // Normal (non-shell) remoteCreated is fully loaded — mark it so so the
        // classifier guard never mistakes it for a shell.
        contentLoaded: true,
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
      // Feature B: the repo's collabId wins so collaborators converge. When the
      // remote carries NO collabId we KEEP the local one (a stable id we may
      // have already shared) rather than clobbering it with undefined.
      const collabId = c.collabId ?? existing.collabId
      byId.set(c.noteId, {
        ...existing,
        content,
        ...(collabId ? { collabId } : {}),
        gitLastPushedSha: await canonicalLocalSha(content, collabId),
        gitRemoteBaseSha: c.remoteSha,
        // pull-dedupe-by-path: link gitPath for a reconciled unlinked note.
        ...(c.adoptPath ? { gitPath: c.adoptPath } : {}),
        updatedAt: now,
      })
      counts.updated++
      continue
    }

    if (c.kind === 'autoMerged') {
      const existing = byId.get(c.noteId)
      if (!existing) continue
      // The merged bytes are in the RAW FILE form (the 3-way merge ran on
      // serialized content), so they may carry a collabId frontmatter block —
      // re-parse to strip it back out of the body and adopt the room id, exactly
      // like the manual-merge path (applyMergedConflict). For a body-only note
      // (the norm) parseNote is a no-op pass-through, so behaviour is unchanged.
      const parsed = parseNote(c.mergedContent)
      const content = bodyWithInlineTags(parsed.body, parsed.tags)
      const collabId = parsed.collabId ?? existing.collabId
      byId.set(c.noteId, {
        ...existing,
        content,
        ...(collabId ? { collabId } : {}),
        // The merged bytes are the new local content; pin the baseline to
        // their canonical SHA. The remote base stays the remote SHA we merged
        // against — the next push will upload the union edit and re-coincide
        // the two SHAs.
        gitLastPushedSha: await canonicalLocalSha(content, collabId),
        gitRemoteBaseSha: c.remoteSha,
        // pull-dedupe-by-path: link gitPath for a reconciled unlinked note.
        ...(c.adoptPath ? { gitPath: c.adoptPath } : {}),
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
  const { updateNote, getNoteById } = useNoteStore.getState()
  // The diff was on the raw file content (possibly with legacy frontmatter).
  // Re-parse to strip any tags block; merge those tags into the body. A
  // `collabId:` block is parsed back out here too (Feature B), so a resolved
  // merge keeps the note's body clean and adopts the room id from the file.
  const parsed = parseNote(mergedRawFile)
  const collabId = parsed.collabId ?? getNoteById(c.noteId)?.collabId
  updateNote(c.noteId, {
    content: bodyWithInlineTags(parsed.body, parsed.tags),
    ...(collabId ? { collabId } : {}),
    gitLastPushedSha: c.remoteSha,
    gitRemoteBaseSha: c.remoteSha,
    // pull-dedupe-by-path: link gitPath for a reconciled unlinked note that
    // routed through the conflict (merge-tab) path. No-op for normal matches.
    ...(c.adoptPath ? { gitPath: c.adoptPath } : {}),
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
    // pull-dedupe-by-path: a reconciled unlinked note carries adoptPath; link
    // its gitPath on resolution regardless of which side the user picks.
    const adopt = c.adoptPath ? { gitPath: c.adoptPath } : {}
    if (choice === 'remote') {
      // Feature B: adopt the remote room id (repo wins); fall back to the
      // existing local one when the remote frontmatter carried none.
      const collabId = c.remoteCollabId ?? useNoteStore.getState().getNoteById(c.noteId)?.collabId
      updateNote(c.noteId, {
        content: bodyWithInlineTags(c.remoteBody, c.remoteTags),
        ...(collabId ? { collabId } : {}),
        gitLastPushedSha: c.remoteSha,
        gitRemoteBaseSha: c.remoteSha,
        ...adopt,
      })
    } else {
      updateNote(c.noteId, { gitLastPushedSha: c.remoteSha, gitRemoteBaseSha: c.remoteSha, ...adopt })
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

  const attachments = classifications.filter(
    (c): c is Extract<PullClassification, { kind: 'attachmentCreated' | 'attachmentUpdated' }> =>
      c.kind === 'attachmentCreated' || c.kind === 'attachmentUpdated',
  )

  // no-vercel-clone: fetch the attachment bytes with bounded concurrency
  // instead of one blob at a time — on a first clone of a vault with many
  // images the sequential getBlobBytes walk was a second contributor to the
  // 45s watchdog blowout. Behaviour is otherwise identical: a single failed
  // attachment is logged + counted as `failed`, never aborting the batch (so
  // we catch INSIDE the mapper and return null rather than letting
  // mapWithConcurrency reject the whole call on the first error).
  const fetched = await mapWithConcurrency(attachments, DEFAULT_CONCURRENCY, async (c) => {
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
      return { c, bytes, mime }
    } catch (err) {
      console.error(`Failed to fetch attachment ${c.path}:`, err)
      return null
    }
  })

  // IDB writes are cheap and must stay deterministic — apply them in order.
  for (const item of fetched) {
    if (!item) {
      counts.failed++
      continue
    }
    const { c, bytes, mime } = item
    try {
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
