// Per-pane note navigation history — the data structure behind the
// Obsidian-style Back / Forward arrows in the editor header.
//
// A history is a linear list of note ids plus a cursor (`index`) marking
// the entry the user is currently viewing. Semantics match a browser's
// per-tab history:
//
//   - push(id): if the new id differs from the current entry, drop any
//     "forward" entries past the cursor and append the new id, moving the
//     cursor to it. Pushing the id already at the cursor is a no-op (so
//     re-focusing the same note doesn't spam the stack).
//   - back(): move the cursor one step toward the start (if possible).
//   - forward(): move the cursor one step toward the end (if possible).
//   - going back then pushing a NEW id truncates the forward entries —
//     standard browser behaviour.
//
// The structure stores note ids only; resolving an id to an open/focused
// tab is the caller's job (workspaceStore.openNote). Ids that no longer
// resolve to a live note are pruned by `pruneHistory`.

export interface NavHistory {
  entries: string[] // note ids, oldest → newest
  index: number // cursor into entries; -1 when empty
}

export function createHistory(): NavHistory {
  return { entries: [], index: -1 }
}

export function currentEntry(h: NavHistory): string | null {
  if (h.index < 0 || h.index >= h.entries.length) return null
  return h.entries[h.index]
}

export function canGoBack(h: NavHistory): boolean {
  return h.index > 0
}

export function canGoForward(h: NavHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1
}

// Append a note id. No-op if it's already the current entry. Otherwise
// truncates any forward history past the cursor and appends.
export function push(h: NavHistory, noteId: string): NavHistory {
  if (currentEntry(h) === noteId) return h
  const kept = h.entries.slice(0, h.index + 1)
  kept.push(noteId)
  return { entries: kept, index: kept.length - 1 }
}

// Move the cursor back one step. Returns the same object when already at
// the start so callers can detect a no-op by reference equality.
export function back(h: NavHistory): NavHistory {
  if (!canGoBack(h)) return h
  return { entries: h.entries, index: h.index - 1 }
}

export function forward(h: NavHistory): NavHistory {
  if (!canGoForward(h)) return h
  return { entries: h.entries, index: h.index + 1 }
}

// Drop entries whose note id is no longer live (deleted notes), then
// collapse any runs of duplicates that removal may have created and
// re-anchor the cursor on the entry it used to point at (or the nearest
// surviving earlier entry). Returns the same object when nothing changed.
export function pruneHistory(h: NavHistory, liveIds: ReadonlySet<string>): NavHistory {
  if (h.entries.length === 0) return h
  // Map each surviving entry to whether it should be kept.
  const target = currentEntry(h)
  const kept: string[] = []
  for (const id of h.entries) {
    if (!liveIds.has(id)) continue
    // Collapse consecutive duplicates that pruning may surface.
    if (kept.length > 0 && kept[kept.length - 1] === id) continue
    kept.push(id)
  }
  if (kept.length === h.entries.length && !h.entries.some(id => !liveIds.has(id))) {
    return h
  }
  if (kept.length === 0) return createHistory()
  // Re-anchor: prefer the entry the cursor used to point at; else clamp.
  let index = target != null ? kept.lastIndexOf(target) : -1
  if (index === -1) index = Math.min(h.index, kept.length - 1)
  return { entries: kept, index: Math.max(0, index) }
}
