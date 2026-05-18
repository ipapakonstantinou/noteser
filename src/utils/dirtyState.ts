// Detects whether the active vault has unpushed changes — used by
// `GitHubRepoModal` to prompt the user before switching to a different repo.
//
// Rules:
//   - If `lastSyncedAt` is non-null (we have a sync baseline for this repo),
//     count any non-deleted note with `updatedAt > lastSyncedAt`.
//   - If `lastSyncedAt` is null (the repo has never been synced from this
//     client — first connect, or a switch back to a repo we hadn't synced
//     since the per-repo sync map was introduced), fall back to counting any
//     non-deleted note in the vault. We'd rather show a one-time "X notes
//     are unpushed" prompt than silently switch with potentially unsynced
//     work.
//
// The user clears the prompt by hitting "Push first" once — that records
// `lastSyncedAt`, after which the time-based path takes over.
import { useNoteStore } from '@/stores/noteStore'
import { useGitHubStore } from '@/stores/githubStore'

// Single source of truth for which note IDs count as "unpushed". Both the
// count display and the discard action consume this so they can't disagree.
export function getUnpushedNoteIds(): string[] {
  const lastSyncedAt = useGitHubStore.getState().lastSyncedAt
  const notes = useNoteStore.getState().notes
  const ids: string[] = []
  for (const n of notes) {
    if (n.isDeleted) continue
    if (lastSyncedAt == null) {
      ids.push(n.id)
      continue
    }
    if (n.updatedAt > lastSyncedAt) ids.push(n.id)
  }
  return ids
}

export function getUnpushedChangeCount(): number {
  return getUnpushedNoteIds().length
}

export function hasUnpushedChanges(): boolean {
  return getUnpushedChangeCount() > 0
}

// Permanently remove the unpushed notes from the current vault.
//   - Notes that were on the remote will reappear on the next sync (since
//     the remote copy is untouched), so this acts as a revert-to-remote.
//   - Notes that were never pushed (no `gitLastPushedSha`) are lost. That's
//     the intent — the user opted to discard them explicitly.
export function discardUnpushedChanges(): void {
  const { permanentlyDeleteNote } = useNoteStore.getState()
  for (const id of getUnpushedNoteIds()) permanentlyDeleteNote(id)
}
