// Push half of the sync pipeline. Builds a single GitHub commit out of the
// local note + attachment state, with idempotency / no-churn guards layered
// on top.
//
// Split out of the monolithic `githubSync.ts` so the push-specific logic can
// be read and tested in isolation. The public surface is preserved verbatim
// via the `../githubSync.ts` barrel — external callers should keep importing
// from `@/utils/githubSync`.

import type { Note, SyncRepo } from '@/types'
import { gitBlobSha } from '../github'
import type { GitHostProvider, FileChange, CommitProgress } from '../gitHost/types'
import { _resetUploadedShaCache } from '../gitHost/githubProvider'
import {
  listAttachmentPathsTracked,
  getAttachmentBlob,
  getAttachmentGitShaTracked,
  getAttachmentDoNotSyncTracked,
  getAttachmentTombstones,
  clearAttachmentTombstones,
} from '../attachments'
import {
  maybeEncryptForPush,
  maybeDecryptFromPull,
  pushPath,
  serializeNote,
  isUnchangedModuloNormalization,
  type SyncResult,
} from './internal'

// ── Sync orchestrator ───────────────────────────────────────────────────────

export type PushProgress =
  | { phase: 'computing' }
  | { phase: 'uploading-blobs'; uploaded: number; total: number; skipped: number }
  | { phase: 'creating-tree' }
  | { phase: 'creating-commit' }
  | { phase: 'updating-ref' }
  | { phase: 'done' }

export interface SyncInput {
  // Host abstraction for the final write. syncToGitHub builds a host-neutral
  // FileChange[] and hands it to provider.commitChanges; the provider turns it
  // into commits its host's way (GitHub: blob/tree/commit/ref).
  provider: GitHostProvider
  repo: SyncRepo
  notes: Note[]
  folders: import('@/types').Folder[]
  // Optional override for the GitHub commit message. When omitted we
  // auto-generate "Sync from Noteser (N changes)". Used by the
  // obsidian-git-style commit-message box (vscg).
  commitMessage?: string
  // Vault settings bundle (vs8x). Caller serializes the vault slice +
  // hash + last-pushed-hash; we include the file in the push tree when
  // either the hash changed locally or the file is missing remotely.
  // Pass undefined to skip settings sync entirely (e.g. user cleared
  // settingsFolderPath).
  vaultSettings?: {
    path: string
    content: string
    contentHash: string
    lastPushedHash: string
  }
  // Pending vault `.gitignore` edit from the in-app editor (gi9n
  // Settings UI). When provided, the push tree includes a `.gitignore`
  // blob with this content IF it differs from the current remote file.
  // Pass undefined when the user hasn't touched the editor — the
  // remote file is left alone.
  vaultGitignoreDraft?: string | null
  // Push-progress hook so the UI can surface "uploading 47 / 200 blobs"
  // and tell the user which step failed when an error bubbles. Optional.
  onProgress?: (event: PushProgress) => void
}

// The blob upload-cache now lives in GitHubProvider (it is a GitHub-blob
// optimization). Re-exported here so the public test hook keeps its import
// path (`@/utils/githubSync`).
export { _resetUploadedShaCache }

export type GitPathUpdate = {
  noteId: string
  gitPath: string | null
  // Blob SHA of what we just pushed for this note. Null when the note's file
  // was deleted in this commit. After a push the remote file IS
  // serializeNote(note), so this is BOTH the canonical local baseline and the
  // remote merge base — gitRemoteBaseSha below is set to the same value.
  gitLastPushedSha: string | null
  // The remote merge-base SHA to persist alongside gitLastPushedSha. Coincides
  // with gitLastPushedSha after a push (the pushed blob is the new remote
  // file). Null when the file was deleted.
  gitRemoteBaseSha: string | null
}

export interface SyncOutcome {
  result: SyncResult
  // The caller applies these updates to the note store so each note remembers
  // where it lives in the repo (and which ones are no longer there).
  pathUpdates: GitPathUpdate[]
  // Set when the vault settings file was included in the push (or was
  // already up to date with `lastPushedHash`). Caller should persist
  // this so subsequent pushes skip when content-equal.
  vaultSettingsHashPushed?: string
  // True when this push wrote the vault `.gitignore` (i.e. the caller's
  // `vaultGitignoreDraft` differed from remote and we uploaded it).
  // Caller should clear the draft + refresh its snapshot to the pushed
  // content so the next sync doesn't try to push again.
  vaultGitignorePushed?: boolean
}

export async function syncToGitHub(input: SyncInput): Promise<SyncOutcome> {
  const { provider, repo, notes, folders, commitMessage, vaultSettings, vaultGitignoreDraft, onProgress } = input
  const { branch } = repo
  onProgress?.({ phase: 'computing' })

  // 1. Compute desired files for every active note.
  // progressive-clone: EXCLUDE shells (contentLoaded === false) outright. A
  // shell's `content` is '' (a placeholder, not the real body), so it must
  // never participate in the push: it would (a) upload an empty blob over the
  // real remote file, and (b) — if we only skipped it from `desired` — get
  // detected as a missing path by the deletion loop (step 4) and emit a
  // `sha: null` DELETE for the real file. Dropping it from activeNotes here
  // keeps it out of BOTH paths; the shell stays exactly as the remote has it
  // until its body loads and contentLoaded flips true. This is the push-side
  // half of the #1 sync-safety rule (the pull-side half is the classifier
  // guard in pullFromGitHub).
  //
  // foreign-vault-files: ALSO exclude `kind: 'foreign'` notes. They are
  // read-only mirrors of remote files we cannot edit (e.g. `.canvas`,
  // `.base`) — their `content` is intentionally empty and pushing them would
  // overwrite the real remote file with empty bytes. Same dropping pattern
  // as shells: out of `activeNotes` keeps them out of BOTH `desired` and the
  // deletion loop in step 4.
  //
  // do-not-sync (#179): ALSO exclude `doNotSync: true` notes (the seeded
  // Feature tour). They are app-local content that must never be serialized
  // into the push tree — no blob, no rename/delete propagation. Same dropping
  // pattern as shells/foreign. We keep them in a separate list because their
  // remote paths (legacy users may have pushed the note before the flag
  // existed) still need delete-safety-net protection below.
  const syncEligibleNotes = notes.filter(n => !n.isDeleted && n.contentLoaded !== false && n.kind !== 'foreign')
  const doNotSyncNotes = syncEligibleNotes.filter(n => n.doNotSync === true)
  const activeNotes = syncEligibleNotes.filter(n => n.doNotSync !== true)
  const desired = new Map<string, { content: string; note: Note }>()
  for (const note of activeNotes) {
    // preserve-gitpath-on-push: a synced note pushes to its EXISTING gitPath
    // verbatim; only a new note (no gitPath) derives a fresh path from its
    // title. This is what stops the sanitizer-relax churn — a cloned note keeps
    // the exact remote path even when the title contains characters the
    // sanitizer would alter. See pushPath() for the rename rationale.
    const path = pushPath(note, folders)
    const content = serializeNote(note)
    // If two notes resolve to the same path (e.g. duplicate titles in same
    // folder), the later one in the array wins. Acceptable for v1.
    desired.set(path, { content, note })
  }

  // 2. Fetch the current branch state. PLAIN reads (not the pull path's
  // ETag-conditional variants) — a stale tree here risks a non-fast-forward
  // commit, so push always talks to the live remote state.
  const parentCommitSha = await provider.getBranchHeadSha(repo)
  const baseTreeSha = await provider.getCommitTreeSha(repo, parentCommitSha)
  const remoteTree = await provider.getTreeMap(repo, baseTreeSha)

  // Layered gitignore matcher for push (gi9n): defaults + remote +
  // local overlay. Same composition as the pull side so push and pull
  // agree on what to skip.
  const { parseGitignore, DEFAULT_MATCHER, DEFAULT_IGNORE_LINES, GITIGNORE_PATH } = await import('../gitignore')
  let pushMatcher = DEFAULT_MATCHER
  const remoteGitignoreSha = remoteTree.get(GITIGNORE_PATH)
  let pushRemoteRaw = ''
  if (remoteGitignoreSha) {
    try {
      pushRemoteRaw = await provider.getBlobContent(repo, remoteGitignoreSha)
    } catch {
      pushRemoteRaw = ''
    }
  }
  try {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const overlay = useSettingsStore.getState().localGitignoreOverlay || ''
    const combined = [
      DEFAULT_IGNORE_LINES.join('\n'),
      pushRemoteRaw,
      overlay,
    ].filter(s => s && s.trim().length > 0).join('\n')
    pushMatcher = parseGitignore(combined)
  } catch {
    // Defaults already applied above.
  }

  // 3. Build the host-neutral change set for CHANGED files only. Unchanged
  // files are NOT listed — the host carries them forward from the parent
  // tree, so a no-churn sync produces an empty `changes` and never touches
  // the host (see the early return below).
  const changes: FileChange[] = []
  const pathUpdates: GitPathUpdate[] = []
  let created = 0
  let updated = 0
  let deleted = 0

  // Path-metadata updates for genuinely-changed notes are recorded as
  // candidates here and committed AFTER the push, gated on whether the host
  // actually transmitted that path's content this attempt (CommitResult
  // .uploadedPaths). This mirrors the old behavior where a note whose blob
  // was served from the same-session upload cache got a tree entry but NO
  // pathUpdate.
  const uploadedNotePathUpdate = new Map<string, GitPathUpdate>()

  // We snapshot per-note pushed content so the editor's gutter diff
  // (109) can compare against it. The IDB write is fire-and-forget
  // outside the loop — collect first, write after the loop ends to
  // avoid serial awaits per note.
  const lastPushedToSnapshot: Array<{ noteId: string; content: string }> = []

  // Pre-pass: classify every desired path into "skip" (remote already has
  // this SHA, or the note wasn't genuinely edited) vs "push". Keeping this
  // separate from the host write lets the genuine-edit / normalization-churn
  // logic stay here while the provider owns the actual blob upload + dedupe.
  //
  // push-only-real-edits: the upload decision must reflect a GENUINE local
  // edit, not just a wire-form mismatch against the remote blob. The remote
  // blob can be in a NON-CANONICAL shape (e.g. an imported Obsidian vault with
  // no trailing newline, or frontmatter we strip on store), so `remoteSha`
  // routinely differs from our canonical `localSha` even when the user never
  // touched the note. Uploading on that mismatch rewrites the user's vault into
  // noteser's canonical form on every sync (the churn bug).
  //
  // The authoritative "did the user edit this?" signal is the PLAINTEXT
  // canonical SHA (`plainSha = gitBlobSha(serializeNote(note))`) vs the note's
  // `gitLastPushedSha` baseline (set by syncApply/backgroundFill to the
  // canonical SHA as of the last sync). When they match the body is byte-equal
  // to what we last synced → NO genuine edit. A null baseline means a
  // new/never-synced note → MUST push. We use `plainSha` (NOT the wire/encrypted
  // sha) ONLY for this change decision; `localSha` (wire) is the git content sha
  // we compare against `remoteSha` to decide whether the file actually changed.
  interface NoteBlobPlan { path: string; content: string; note: Note; localSha: string; remoteSha: string | undefined; locallyChanged: boolean }
  const noteBlobPlan: NoteBlobPlan[] = []
  for (const [path, { content, note }] of desired) {
    if (pushMatcher.isIgnored(path)) continue
    // bke1: when encryption is enabled, the wire form is what we hash
    // and upload. plaintext stays available for the editor's gutter
    // snapshot (it compares against the unencrypted body).
    const wireContent = await maybeEncryptForPush(content)
    const localSha = await gitBlobSha(wireContent)
    // Plaintext canonical SHA for the genuine-edit decision. `content` here is
    // the canonical plaintext (serializeNote output) BEFORE encryption.
    const plainSha = await gitBlobSha(content)
    const baseline = note.gitLastPushedSha ?? null
    const remoteSha = remoteTree.get(path)
    // Primary signal: the canonical SHA equals the baseline → byte-identical to
    // what we last synced → not a real edit. A null baseline is a brand-new note.
    let locallyChanged = baseline === null || plainSha !== baseline

    // content-normalization-churn: the canonical-SHA test above mis-fires for a
    // note whose baseline is the RAW (non-canonical) remote blob rather than the
    // canonical serialisation — a LEGACY note (synced before gitLastPushedSha was
    // pinned to the canonical form) or a conflict-resolved note. There the remote
    // blob lacks a trailing newline (or uses CRLF), so plainSha (canonical, with
    // \n) != baseline (raw) even though the user never typed a thing — the churn.
    //
    // Disambiguate with a BYTE-EXACT comparison: when the baseline IS the current
    // remote blob (baseline === remoteSha), the note was last synced AS that exact
    // blob and its gitPath hasn't moved. Fetch the remote body ONCE and compare it
    // to the local body modulo normalization. If they match, the difference is
    // pure CRLF/trailing-newline drift → UNEDITED → suppress (leave the user's
    // original non-canonical bytes on the remote untouched, exactly like the
    // canonical-baseline path does). This network read only happens for the legacy
    // drift case (SHA says changed AND baseline names the live remote blob), so the
    // hot path (canonical baseline, or a genuine edit) pays nothing.
    if (locallyChanged && baseline !== null && remoteSha !== undefined && baseline === remoteSha) {
      try {
        const remoteRawBody = await maybeDecryptFromPull(
          await provider.getBlobContent(repo, remoteSha),
        )
        if (isUnchangedModuloNormalization(content, remoteRawBody)) {
          locallyChanged = false
        }
      } catch {
        // Network blip / GC'd blob — fall back to the SHA decision (treat as a
        // possible edit). Worst case is one re-push, never data loss.
      }
    }

    noteBlobPlan.push({ path, content: wireContent, note, localSha, remoteSha, locallyChanged })
  }
  // push-only-real-edits: SUPPRESS the push for a note that is NOT locally
  // changed AND already has a remote blob at this path. We emit NO change for
  // it, so the base tree's existing (user's original, possibly non-canonical)
  // blob is preserved untouched — zero rewrite. We STILL push when the note is
  // locally changed (a real edit) OR has no remote blob yet (`remoteSha ===
  // undefined`: a brand-new note, or a note moved to a new path — the move's
  // old-path deletion is handled by the deletion loop in step 4).
  const noteBlobsSuppressed = noteBlobPlan.filter(p => !p.locallyChanged && p.remoteSha !== undefined && p.remoteSha !== p.localSha)
  const suppressedNoteIds = new Set(noteBlobsSuppressed.map(p => p.note.id))

  // Genuinely-changed notes (remoteSha differs from what we'd push, and not
  // suppressed) become create/update FileChanges. The provider owns the blob
  // upload + same-session content cache; here we just describe WHAT changed.
  for (const plan of noteBlobPlan) {
    if (suppressedNoteIds.has(plan.note.id)) continue
    if (plan.remoteSha === plan.localSha) continue
    changes.push({
      op: plan.remoteSha ? 'update' : 'create',
      path: plan.path,
      content: plan.content,
      // Forgejo's ChangeFiles requires the current blob sha when updating an
      // existing file; GitHub ignores it. Undefined for a create (no remote
      // file yet), matching the delete path which also carries remoteSha.
      sha: plan.remoteSha,
    })
    if (plan.remoteSha) updated++; else created++
    // Candidate pathUpdate — committed after the push only if the provider
    // actually transmitted this path's content this attempt (uploadedPaths).
    // After a push the pushed blob IS the remote file, so the local baseline
    // and the remote merge base coincide — set both to localSha (== the git
    // content sha the host stores).
    if (plan.note.gitPath !== plan.path || plan.note.gitLastPushedSha !== plan.localSha || plan.note.gitRemoteBaseSha !== plan.localSha) {
      uploadedNotePathUpdate.set(plan.path, { noteId: plan.note.id, gitPath: plan.path, gitLastPushedSha: plan.localSha, gitRemoteBaseSha: plan.localSha })
    }
  }
  // Pure-skip notes (remote already has this SHA): no change, but the note's
  // path metadata may still need an update. The lastPushedSnapshot gets the
  // PLAINTEXT body (gutter compares against unencrypted text).
  //
  // push-only-real-edits: a SUPPRESSED note (unchanged but its canonical wire
  // SHA differs from the non-canonical remote blob) is left ENTIRELY untouched:
  // no change AND no pathUpdate. Emitting a pathUpdate here would rewrite
  // gitLastPushedSha to the wire SHA, overwriting the canonical baseline
  // syncApply pinned — which would make the NEXT pull misclassify the note
  // (localChanged would flip on every sync). The note did not change, so we
  // leave gitPath / gitLastPushedSha / gitRemoteBaseSha exactly as they are. We
  // still take a gutter snapshot (body is unchanged, so the plaintext is correct).
  for (const plan of noteBlobPlan) {
    const suppressed = suppressedNoteIds.has(plan.note.id)
    const skipped = plan.remoteSha === plan.localSha
    if (!suppressed && skipped) {
      // After a push the pushed blob IS the remote file, so the local baseline
      // and the remote merge base coincide — set both to finalSha.
      const finalSha = plan.remoteSha!
      if (plan.note.gitPath !== plan.path || plan.note.gitLastPushedSha !== finalSha || plan.note.gitRemoteBaseSha !== finalSha) {
        pathUpdates.push({ noteId: plan.note.id, gitPath: plan.path, gitLastPushedSha: finalSha, gitRemoteBaseSha: finalSha })
      }
    }
    // Gutter snapshot uses the plaintext, not the wire form — look it up
    // from `desired` rather than `plan.content` (which is the wire form).
    const desiredEntry = desired.get(plan.path)
    if (desiredEntry) {
      lastPushedToSnapshot.push({ noteId: plan.note.id, content: desiredEntry.content })
    }
  }

  // Fire-and-forget the per-note snapshot writes. The gutter will pick
  // them up on the next render — we don't await because a slow IDB
  // flush shouldn't block the push completing.
  void (async () => {
    const { setLastPushedContent } = await import('../lastPushedContent')
    for (const { noteId, content } of lastPushedToSnapshot) {
      try { await setLastPushedContent(noteId, content) } catch { /* silent — gutter is best-effort */ }
    }
  })()

  // 3b. Local attachments → binary FileChanges. Push uploads any local
  // attachment whose SHA differs from the remote. Files only present locally
  // get created remotely; files present in both get updated when their content
  // drifts. The provider handles the binary blob upload + content cache.
  //
  // attachment-timeout-retry: a stalled IDB read (mobile Safari) must not
  // silently look like "zero local attachments" — that would push a commit
  // that omits real attachments while reporting the sync as successful, and
  // nothing would ever retry it (the attachment was already durably saved
  // locally, just never uploaded). So the *Tracked reads report `timedOut`
  // and, the moment any one of them fires, we abort the ENTIRE attachment
  // section for this cycle: no partial plan, no FileChanges, no bookkeeping.
  // Because nothing gets marked as pushed, the next sync's 3b runs exactly as
  // if this one never attempted it — that's what makes the retry automatic
  // without a dedicated retry-queue.
  let attachmentSyncSkipped = false
  const { value: localAttachmentPaths, timedOut: listTimedOut } = await listAttachmentPathsTracked()
  if (listTimedOut) attachmentSyncSkipped = true
  interface AttachmentPlan { path: string; localSha: string; remoteSha: string | undefined }
  const attachmentPlan: AttachmentPlan[] = []
  for (const path of localAttachmentPaths) {
    if (attachmentSyncSkipped) break
    if (pushMatcher.isIgnored(path)) continue
    // do-not-sync (#179): app-local attachments (the seeded feature-tour
    // screenshots) are flagged on their stored record and never enter the
    // push plan — no hash, no upload, no tree entry. This is a per-record
    // flag, NOT a path exclusion: a user's own folder that happens to be
    // named `feature-tour/` syncs normally.
    const { value: doNotSync, timedOut: dnsTimedOut } = await getAttachmentDoNotSyncTracked(path)
    if (dnsTimedOut) { attachmentSyncSkipped = true; break }
    if (doNotSync) continue
    const { value: localSha, timedOut: shaTimedOut } = await getAttachmentGitShaTracked(path)
    if (shaTimedOut) { attachmentSyncSkipped = true; break }
    if (!localSha) continue
    const remoteSha = remoteTree.get(path)
    attachmentPlan.push({ path, localSha, remoteSha })
  }
  const effectiveAttachmentPlan = attachmentSyncSkipped ? [] : attachmentPlan
  if (attachmentSyncSkipped) {
    console.warn('[syncPush] attachment sync skipped this cycle (IndexedDB stalled) — will retry next sync.')
  }
  for (const plan of effectiveAttachmentPlan) {
    if (plan.remoteSha === plan.localSha) continue
    const blob = await getAttachmentBlob(plan.path)
    if (!blob) continue
    const contentBytes = new Uint8Array(await blob.arrayBuffer())
    changes.push({ op: plan.remoteSha ? 'update' : 'create', path: plan.path, contentBytes, sha: plan.remoteSha })
    if (plan.remoteSha) updated++; else created++
  }

  // 3c. Apply attachment tombstones — paths the user explicitly deleted
  // locally need to be removed from the remote tree, otherwise pull would
  // re-download them every cycle (the orphan-comes-back bug). We only
  // delete entries that actually exist remotely; stale tombstones (file
  // already gone remotely) get cleared too.
  //
  // Skipped alongside 3b when attachment state is untrustworthy this cycle:
  // consuming tombstones here would clear them even though we never confirmed
  // what's actually on disk, and a deletion decided from partial/absent local
  // state is exactly the kind of "confirmed" bookkeeping we must not write.
  const tombstones = attachmentSyncSkipped ? [] : await getAttachmentTombstones()
  const consumedTombstones: string[] = []
  for (const path of tombstones) {
    const remoteSha = remoteTree.get(path)
    if (remoteSha !== undefined) {
      changes.push({ op: 'delete', path, sha: remoteSha })
      deleted++
    }
    consumedTombstones.push(path)
  }

  // 3d-pre. Vault `.gitignore` editor draft (gi9n Settings UI). Push
  // a tree entry for `.gitignore` only when the caller provided a
  // draft AND it differs from the current remote content. Skipping
  // the no-change case keeps idle syncs commit-free.
  let vaultGitignorePushed = false
  if (vaultGitignoreDraft != null && vaultGitignoreDraft !== pushRemoteRaw) {
    changes.push({ op: remoteGitignoreSha ? 'update' : 'create', path: GITIGNORE_PATH, content: vaultGitignoreDraft, sha: remoteGitignoreSha })
    if (remoteGitignoreSha) updated++; else created++
    vaultGitignorePushed = true
  }

  // 3d. Vault settings file (vs8x). Include it in the push tree when
  // either (a) the local hash differs from the last pushed hash (the
  // user changed something), or (b) the file is missing remotely (first
  // push for this vault). Skip altogether if the caller didn't pass a
  // vaultSettings bundle (settings sync disabled).
  let vaultSettingsHashPushed: string | undefined
  if (vaultSettings) {
    const { path, content, contentHash, lastPushedHash } = vaultSettings
    const remoteHasFile = remoteTree.has(path)
    const localChanged = contentHash !== lastPushedHash
    if (localChanged || !remoteHasFile) {
      changes.push({ op: remoteHasFile ? 'update' : 'create', path, content, sha: remoteTree.get(path) })
      if (remoteHasFile) updated++; else created++
      vaultSettingsHashPushed = contentHash
    } else {
      // Already up to date on remote — surface the hash so the caller
      // doesn't need to re-derive it.
      vaultSettingsHashPushed = contentHash
    }
  }

  // 4. Handle deletions: notes that USED to have a gitPath but no longer
  // resolve there (rename or moved folder) and notes that are now in trash.
  const desiredPaths = new Set(desired.keys())
  const seenGitPaths = new Set<string>()

  // rename-not-delete HARD PUSH-SIDE SAFETY NET (the critical data-loss
  // preventer). Before we emit ANY delete, build the set of remote paths
  // that a LIVE (non-deleted) note still represents. A remote file at such a
  // path MUST NOT be deleted, even if some upstream classification was wrong
  // (e.g. a rename misread as a delete that soft-deleted the note).
  //
  // A path is protected when EITHER:
  //   (a) it is in `desired` — an active note's CURRENT computed path maps to
  //       it (the note literally lives there now), OR
  //   (b) a live note's serialized content hash equals the remote blob SHA at
  //       that path — the file's content IS a live note, just under a name
  //       whose form no longer matches the note's stored path (the dash↔space
  //       rename case). Deleting it would destroy the user's real note.
  // We hash each live note ONCE here (and only for paths present in the remote
  // tree, so we never pay for paths we wouldn't delete anyway).
  const protectedRemotePaths = new Set<string>(desiredPaths)
  {
    // do-not-sync (#179): a flagged note never pushes, but a LEGACY user's
    // remote may still hold its file (pushed before the flag existed). That
    // path must be protected from deletion — e.g. the tour seeder soft-deletes
    // duplicate tour notes, and a soft-deleted duplicate sharing the flagged
    // live note's gitPath must not sha:null the file the live note maps to.
    // Protect by stored path, by current computed path, and (below) by
    // content/baseline SHA, exactly like live active notes.
    for (const note of doNotSyncNotes) {
      if (note.gitPath) protectedRemotePaths.add(note.gitPath)
      protectedRemotePaths.add(pushPath(note, folders))
    }
    const liveProtectedNotes = [...activeNotes, ...doNotSyncNotes]
    // Map remote path → its blob SHA, but only for paths some live note could
    // be defending. We need a SHA→paths index to test content equality.
    const livePlainShaByNote = new Map<string, string>()
    for (const note of liveProtectedNotes) {
      const sha = await gitBlobSha(serializeNote(note))
      livePlainShaByNote.set(note.id, sha)
    }
    const liveShaSet = new Set(livePlainShaByNote.values())
    // Also count any baseline SHA a live note last pushed — a note whose body
    // hasn't been re-serialized identically (e.g. non-canonical remote) is
    // still defended by the SHA it was pushed as.
    for (const note of liveProtectedNotes) {
      if (note.gitLastPushedSha) liveShaSet.add(note.gitLastPushedSha)
    }
    for (const [path, remoteSha] of remoteTree) {
      if (protectedRemotePaths.has(path)) continue
      if (liveShaSet.has(remoteSha)) protectedRemotePaths.add(path)
    }
  }

  for (const note of activeNotes) {
    if (note.gitPath) seenGitPaths.add(note.gitPath)
    if (note.gitPath && !desiredPaths.has(note.gitPath) && remoteTree.has(note.gitPath)) {
      // Safety net: never delete a path a live note still represents (by
      // content), even though this note's CURRENT path moved away from it.
      if (protectedRemotePaths.has(note.gitPath)) continue
      changes.push({ op: 'delete', path: note.gitPath, sha: remoteTree.get(note.gitPath) })
      deleted++
    }
  }
  for (const note of notes) {
    // foreign-vault-files: a `kind: 'foreign'` note is a read-only mirror —
    // it must never push a delete to the remote even if the user (somehow)
    // soft-deletes the mirror locally. Just skip it; the real file stays put.
    if (note.kind === 'foreign') continue
    // do-not-sync (#179): a flagged note never touches the remote, deletes
    // included. Soft-deleting the seeded tour note locally must not emit a
    // delete for a legacy user's remote copy — remote cleanup is manual.
    // Skipping also leaves its git fields intact in case it is restored.
    if (note.doNotSync) continue
    if (note.isDeleted && note.gitPath && remoteTree.has(note.gitPath)) {
      // Only delete if no active note has already moved into that path AND no
      // live note's content maps to it. The protectedRemotePaths check is the
      // hard guard: a soft-deleted note's gitPath that an active note still
      // represents (by current path OR by content hash) must survive — the
      // delete classification was a rename misread, not a real deletion.
      if (
        !desired.has(note.gitPath) &&
        !seenGitPaths.has(note.gitPath) &&
        !protectedRemotePaths.has(note.gitPath)
      ) {
        changes.push({ op: 'delete', path: note.gitPath, sha: remoteTree.get(note.gitPath) })
        deleted++
      }
      pathUpdates.push({ noteId: note.id, gitPath: null, gitLastPushedSha: null, gitRemoteBaseSha: null })
    }
  }

  if (changes.length === 0) {
    // No changed files → nothing to commit. The host carries the whole tree
    // forward unchanged, so we never touch it (the no-churn invariant: 0
    // network calls). Even so, clear stale tombstones (files already gone
    // remotely) so they don't re-attempt every sync.
    if (consumedTombstones.length > 0) await clearAttachmentTombstones(consumedTombstones)
    return {
      result: { unchanged: true, created: 0, updated: 0, deleted: 0, commitSha: parentCommitSha, commitUrl: null, attachmentSyncSkipped },
      pathUpdates,
      vaultSettingsHashPushed,
      vaultGitignorePushed,
    }
  }

  // 5. Hand the change set to the host. provider.commitChanges turns it into
  // a commit its host's way (GitHub: blob/tree/commit/ref). We translate its
  // host-agnostic progress back into the external PushProgress stream so the
  // UI sequence is unchanged.
  const total = created + updated + deleted
  const autoMessage = `Sync from Noteser (${total} change${total === 1 ? '' : 's'})`
  const message = commitMessage && commitMessage.length > 0 ? commitMessage : autoMessage

  const translateCommitProgress = (e: CommitProgress) => {
    switch (e.phase) {
      case 'uploading-blobs':
        onProgress?.({ phase: 'uploading-blobs', uploaded: e.uploaded, total: e.total, skipped: e.skipped })
        break
      case 'building-tree':
        onProgress?.({ phase: 'creating-tree' })
        break
      case 'committing':
        onProgress?.({ phase: 'creating-commit' })
        break
      case 'updating-ref':
        onProgress?.({ phase: 'updating-ref' })
        break
    }
  }

  const commit = await provider.commitChanges(repo, {
    branch,
    parentSha: parentCommitSha,
    message,
    changes,
    onProgress: translateCommitProgress,
  })

  // Record path-metadata updates only for note paths the host actually
  // transmitted this attempt (see uploadedNotePathUpdate's note). A path
  // served from the host's same-session content cache keeps its prior
  // metadata, matching the old cached-blob behavior.
  for (const path of commit.uploadedPaths) {
    const upd = uploadedNotePathUpdate.get(path)
    if (upd) pathUpdates.push(upd)
  }

  // Push reached the host (whether or not it produced a commit) — drop
  // tombstones whose deletes are now applied so they don't re-attempt.
  if (consumedTombstones.length > 0) await clearAttachmentTombstones(consumedTombstones)
  onProgress?.({ phase: 'done' })

  // committed:false means the host found the change set was a no-op (e.g. the
  // built tree was byte-identical to the parent's). Report it as unchanged,
  // exactly like the old empty-tree skip did.
  if (!commit.committed) {
    return {
      result: { unchanged: true, created: 0, updated: 0, deleted: 0, commitSha: commit.commitSha, commitUrl: commit.commitUrl, attachmentSyncSkipped },
      pathUpdates,
      vaultSettingsHashPushed,
      vaultGitignorePushed,
    }
  }

  return {
    result: { unchanged: false, created, updated, deleted, commitSha: commit.commitSha, commitUrl: commit.commitUrl, attachmentSyncSkipped },
    pathUpdates,
    vaultSettingsHashPushed,
    vaultGitignorePushed,
  }
}
