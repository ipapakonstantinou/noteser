// progressive-clone: background + on-open body fill for SHELL notes.
//
// A first clone (see pullFromGitHub isFirstClone) materialises notes as SHELLS:
// title + path + SHAs from the git tree, but content '' and contentLoaded
// false. The sidebar renders instantly from those shells. This module then
// streams the real bodies in:
//   - fillShellsInBackground(): fire-and-forget over ALL outstanding shells,
//     bounded concurrency, called after a pull/sync apply AND on startup if
//     a connected repo still has shells (reload-resume).
//   - ensureNoteBodyLoaded(): load a single shell's body immediately (on-open).
//
// For each shell we fetch the raw remote blob, decrypt if needed, parse out any
// frontmatter, then patch the note: content + canonicalLocalSha(content) +
// contentLoaded true. Pinning gitLastPushedSha to the canonical-local SHA (the
// same value a clean re-push would produce) means the very next pull classifies
// the now-loaded note as `unchanged` instead of a phantom local edit.

import { useNoteStore, useGitHubStore } from '@/stores'
import type { Note, SyncRepo } from '@/types'
import { getBlobContent, gitBlobSha } from './github'
import { serializeNote, parseNote } from './githubSync'
import { bodyWithInlineTags } from './syncApply'
import { decryptNoteContent, isEncryptedContent } from './vaultCrypto'
import { getVaultKey, VaultLockedError } from './vaultKey'
import { mapWithConcurrency, DEFAULT_CONCURRENCY } from './concurrency'
import { withTokenRefresh } from './tokenRefresh'

// Local-canonical blob SHA for the bytes we're about to store. Mirrors
// syncApply.canonicalLocalSha — kept private there, duplicated here to avoid
// widening that module's surface. serializeNote/normalizeForPush is the exact
// canonicaliser the push path uses, so the SHA matches a clean re-push and the
// next pull reads the note as `unchanged`.
function canonicalLocalSha(content: string): Promise<string> {
  return gitBlobSha(serializeNote({ content } as Note))
}

// Decrypt a raw remote blob on read. Pass-through when unencrypted. Throws
// VaultLockedError when an envelope is present but the vault is locked — the
// caller decides whether to surface or swallow it.
async function maybeDecrypt(raw: string): Promise<string> {
  if (!isEncryptedContent(raw)) return raw
  const key = getVaultKey()
  if (!key) {
    throw new VaultLockedError('Cannot load note body — remote blob is encrypted but vault is locked.')
  }
  return await decryptNoteContent(raw, key)
}

// Is this note a shell whose body still needs loading?
export function isShell(note: Pick<Note, 'contentLoaded'>): boolean {
  return note.contentLoaded === false
}

// Fetch + decrypt + parse a single shell's body and patch the note in the
// store. Idempotent: re-running on an already-loaded note is a cheap no-op.
// Returns true when it loaded (or was already loaded), false on a recoverable
// failure (e.g. network blip) so the caller can decide whether to retry.
//
// The blob read runs inside withTokenRefresh (same orchestration as the sync
// pull/push), so an expired OAuth token proactively refreshes — and a 401
// refreshes-once-and-retries — instead of silently stranding the shell until
// the next sync. `repo` is passed in so callers that already hold it (the
// fill loop) don't re-read the store per-note.
async function loadOneShell(
  repo: SyncRepo,
  noteId: string,
): Promise<boolean> {
  const note = useNoteStore.getState().notes.find(n => n.id === noteId)
  // Gone, already loaded, or missing its remote sha → nothing to do.
  if (!note) return true
  if (note.contentLoaded !== false) return true
  const remoteSha = note.gitRemoteBaseSha ?? note.gitLastPushedSha
  if (!remoteSha) {
    // A shell with no remote sha can't be filled — clear the shell flag so it
    // stops being skipped by search/tags and isn't retried forever. Its body
    // stays empty (the safest outcome for a degenerate shell).
    // Patch directly (not updateNote) so updatedAt is not bumped — clearing a
    // degenerate shell's flag is not a user edit.
    useNoteStore.setState(state => ({
      notes: state.notes.map(n =>
        n.id === noteId ? { ...n, contentLoaded: true } : n,
      ),
    }))
    return true
  }

  let raw: string
  try {
    raw = await withTokenRefresh(tok => getBlobContent(tok, repo.owner, repo.name, remoteSha))
  } catch {
    // Network blip OR ReconnectRequiredError (renewal exhausted). Either way
    // the shell stays unloaded and gets retried on the next fill / on-open —
    // a background fill is not the place to surface the reconnect modal.
    return false
  }

  // Decrypt may throw VaultLockedError — let it bubble so the fill loop can
  // stop early (no point hammering the API while locked).
  const content = await maybeDecrypt(raw)
  const parsed = parseNote(content)
  const body = bodyWithInlineTags(parsed.body, parsed.tags)

  // Re-read inside the patch: the user may have started editing the shell
  // between the fetch starting and landing (the on-open path lets them type
  // into a "Loading…" note). If contentLoaded already flipped true, another
  // path won the race — don't clobber it.
  const current = useNoteStore.getState().notes.find(n => n.id === noteId)
  if (!current || current.contentLoaded !== false) return true

  // Patch directly (NOT updateNote) so we do NOT bump updatedAt: loading a
  // note's body from remote is not a user edit. Bumping updatedAt would make
  // every freshly-cloned note look "modified" in the pending-changes count
  // (the "530 pending" right after a clone). The note is in sync with remote
  // (gitLastPushedSha = canonical of the loaded body), so updatedAt stays as-is.
  const loadedSha = await canonicalLocalSha(body)
  useNoteStore.setState(state => ({
    notes: state.notes.map(n =>
      n.id === noteId
        ? { ...n, content: body, gitLastPushedSha: loadedSha, contentLoaded: true }
        : n,
    ),
  }))
  return true
}

// On-open: load a single note's body if it is a shell. Resolves immediately
// for already-loaded notes. Errors are swallowed (the EditorContent "Loading…"
// hint stays until a later fill or re-open succeeds) EXCEPT VaultLockedError,
// which we let bubble so the caller can prompt for unlock.
export async function ensureNoteBodyLoaded(noteId: string): Promise<void> {
  const note = useNoteStore.getState().notes.find(n => n.id === noteId)
  if (!note || note.contentLoaded !== false) return
  const { token, syncRepo } = useGitHubStore.getState()
  if (!token || !syncRepo) return
  await loadOneShell(syncRepo, noteId)
}

// Guards against two concurrent fill loops (e.g. a startup resume racing a
// post-sync kick-off). The second caller is a no-op while one runs.
let fillInFlight = false

// Fire-and-forget background fill over every outstanding shell. Bounded
// concurrency keeps us well under GitHub's secondary rate limits. Reports
// progress via onPhase as "Populating vault… (n / m)". Safe to call when there
// are no shells (returns immediately). Resolves when the pass completes; the
// caller typically does NOT await (it runs in the background).
export async function fillShellsInBackground(
  onPhase?: (msg: string) => void,
): Promise<void> {
  if (fillInFlight) return
  const { token, syncRepo } = useGitHubStore.getState()
  if (!token || !syncRepo) return

  const shellIds = useNoteStore.getState().notes
    .filter(n => !n.isDeleted && n.contentLoaded === false)
    .map(n => n.id)
  if (shellIds.length === 0) return

  fillInFlight = true
  const total = shellIds.length
  let done = 0
  onPhase?.(`Populating vault… (0 / ${total})`)
  try {
    await mapWithConcurrency(shellIds, DEFAULT_CONCURRENCY, async (id) => {
      try {
        await loadOneShell(syncRepo, id)
      } catch (err) {
        // VaultLockedError (or any throw) shouldn't reject the whole batch —
        // we catch per-item so one locked/bad note doesn't strand the rest.
        // The note stays a shell and gets retried on the next fill / on-open.
        if (err instanceof VaultLockedError) throw err
      } finally {
        done++
        onPhase?.(`Populating vault… (${done} / ${total})`)
      }
    })
  } catch {
    // Batch aborted early (e.g. vault locked). Remaining shells persist and
    // resume on the next pull / startup / on-open.
  } finally {
    fillInFlight = false
  }
}

/** Test hook: reset the in-flight guard between tests. */
export function _resetFillInFlight(): void {
  fillInFlight = false
}
