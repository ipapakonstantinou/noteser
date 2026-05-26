// Most-recently-opened-notes (MRU) tracker.
//
// A flat, de-duplicated list of note ids ordered most-recent-first. Unlike
// the per-pane Back/Forward `NavHistory` (which is cursor-based and gets
// truncated when you go back then open something new), this is a simple
// MRU stack: opening a note moves it to the front, capped at a fixed size.
//
// It backs the "Recent" list the quick-switcher / search modal shows when
// the query box is empty (Obsidian quick-switcher / VS Code Ctrl+P style).
// It is deliberately distinct from `noteStore.getRecentNotes`, which sorts
// by `updatedAt` (last *modified*), not last *opened*.

// Default cap. Obsidian's quick switcher shows a handful; ~15 is plenty to
// scroll without overwhelming the list.
export const RECENTS_CAP = 15

// Move `noteId` to the front of the MRU list, removing any earlier
// occurrence, and trim to `cap`. Returns the same array reference when the
// note is already at the front (no observable change) so callers can skip
// a state update.
export function pushRecent(
  recents: readonly string[],
  noteId: string,
  cap: number = RECENTS_CAP,
): string[] {
  if (recents[0] === noteId) return recents as string[]
  const next = [noteId, ...recents.filter(id => id !== noteId)]
  return next.length > cap ? next.slice(0, cap) : next
}

// Drop ids that no longer resolve to a live (non-deleted) note. Returns the
// same array reference when nothing was removed.
export function pruneRecents(
  recents: readonly string[],
  liveIds: ReadonlySet<string>,
): string[] {
  const kept = recents.filter(id => liveIds.has(id))
  return kept.length === recents.length ? (recents as string[]) : kept
}
