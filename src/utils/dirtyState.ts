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

export function getUnpushedChangeCount(): number {
  const lastSyncedAt = useGitHubStore.getState().lastSyncedAt
  const notes = useNoteStore.getState().notes
  let count = 0
  for (const n of notes) {
    if (n.isDeleted) continue
    if (lastSyncedAt == null) {
      count++
      continue
    }
    if (n.updatedAt > lastSyncedAt) count++
  }
  return count
}

export function hasUnpushedChanges(): boolean {
  return getUnpushedChangeCount() > 0
}
