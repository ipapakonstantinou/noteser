import type { Note } from '@/types'
import type { FolderSortMode } from '@/stores'

// Returns a new array sorted per the requested mode. 'manual' returns the
// input array (insertion order) — the only no-op mode. Other modes copy
// before sorting so the input isn't mutated.
export function sortNotes(notes: Note[], mode: FolderSortMode): Note[] {
  if (mode === 'manual') return notes
  const copy = notes.slice()
  if (mode === 'alphabetical') {
    copy.sort((a, b) => a.title.localeCompare(b.title))
  } else if (mode === 'modified') {
    copy.sort((a, b) => b.updatedAt - a.updatedAt)
  } else if (mode === 'created') {
    copy.sort((a, b) => b.createdAt - a.createdAt)
  }
  return copy
}
