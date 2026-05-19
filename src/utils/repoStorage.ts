// Helpers that compute the IndexedDB persistence keys for the notes and
// folders stores. Each connected GitHub repo gets its own scoped key so that
// switching repos in `GitHubRepoModal` swaps in a fresh vault rather than
// re-using one global pile of notes.
//
// The unscoped names (`noteser-notes` / `noteser-folders`) are the stores'
// boot-time defaults and also act as the upgrade source — they get migrated
// into the scoped key on first load once a repo is connected.
import type { SyncRepo } from '@/types'
import { STORAGE_KEYS } from './storageKeys'

export const DEFAULT_NOTES_KEY = STORAGE_KEYS.notes
export const DEFAULT_FOLDERS_KEY = STORAGE_KEYS.folders

export function notesKey(repo: SyncRepo | null): string {
  return repo ? `${DEFAULT_NOTES_KEY}:${repo.owner}/${repo.name}` : DEFAULT_NOTES_KEY
}

export function foldersKey(repo: SyncRepo | null): string {
  return repo ? `${DEFAULT_FOLDERS_KEY}:${repo.owner}/${repo.name}` : DEFAULT_FOLDERS_KEY
}
