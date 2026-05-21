// "Reset to remote" — user-facing escape hatch when local diverged
// from the remote and they just want to start fresh from what GitHub
// has. Three outcomes by intent:
//
//   1. Discard local edits to PUSHED notes (anything with a gitPath).
//      They'll be re-fetched from remote on the next pull.
//   2. Preserve unpushed local notes (no gitPath) by default — these
//      are content the user authored locally and never sent anywhere.
//      An override drops them too for a true "clean slate".
//   3. Clear local attachments (IDB) — they're already in the repo if
//      they got pushed, and unpushed ones go away with their referring
//      notes anyway.
//
// The util doesn't trigger the sync itself — that's the caller's job,
// so it can sequence the reset + sync inside its own loading state /
// modal lifecycle.

import { useNoteStore } from '@/stores/noteStore'

export interface ResetToRemoteOptions {
  // When true (default), notes with no gitPath are kept. When false,
  // every local note is wiped — the only thing left will be whatever
  // the next pull brings back.
  preserveUnpushed?: boolean
}

export interface ResetToRemoteResult {
  // Notes hard-deleted because they had a gitPath (i.e. originated
  // from remote at some point).
  pushedDropped: number
  // Notes hard-deleted because preserveUnpushed=false swept them too.
  unpushedDropped: number
  // Notes left in place (only when preserveUnpushed=true).
  preserved: number
}

/**
 * Synchronously wipe local note state per the strategy above. The
 * caller MUST follow up with a pull to repopulate from the remote
 * (the util only handles the local half so we don't bake sync-flow
 * coupling into a low-level helper).
 *
 * Pure local effect — no network calls. Safe to run before the user
 * has a syncRepo connected (it'd just empty the vault, which is
 * obviously a destructive thing the UI should guard against).
 */
export function resetToRemote(opts: ResetToRemoteOptions = {}): ResetToRemoteResult {
  const preserveUnpushed = opts.preserveUnpushed ?? true
  const { notes } = useNoteStore.getState()

  const pushed = notes.filter(n => !!n.gitPath)
  const unpushed = notes.filter(n => !n.gitPath)

  const next = preserveUnpushed ? unpushed : []

  useNoteStore.setState({
    // selectedNoteId: hold onto the existing selection if the note
    // survives the wipe, otherwise null it out.
    selectedNoteId: (() => {
      const cur = useNoteStore.getState().selectedNoteId
      if (cur == null) return null
      return next.some(n => n.id === cur) ? cur : null
    })(),
    notes: next,
  })

  return {
    pushedDropped: pushed.length,
    unpushedDropped: preserveUnpushed ? 0 : unpushed.length,
    preserved: preserveUnpushed ? unpushed.length : 0,
  }
}
