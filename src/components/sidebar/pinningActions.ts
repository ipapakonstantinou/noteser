// Sidebar panel pin / unpin / group helpers.
//
// Extracted out of SidebarStack so the ActivityBar (formerly Ribbon)
// can call into the same logic when the user drags an icon between the
// pinned-section and the unpinned-section. Pure-ish: every helper reads
// the current pinned groups, computes the next array, and writes it
// back via `setPinnedPanels`. Callers pass `pinnedGroups` to avoid each
// helper re-reading + re-sanitising the raw store value.

import { useSettingsStore, type SidebarTabId } from '@/stores'

// Push `id` as a new solo group at the END of the stack. No-op when
// the id is already pinned anywhere — pinning twice would let the
// same panel live in two groups, which the rest of the system isn't
// built for.
export function pinAsNewGroup(
  pinnedGroups: SidebarTabId[][],
  id: SidebarTabId,
): void {
  const flat = pinnedGroups.flat()
  if (flat.includes(id)) return
  useSettingsStore.getState().setPinnedPanels([...pinnedGroups, [id]])
}

// Push `id` as a new solo group at a SPECIFIC insert position. Used
// by the inter-group drop zones so the user can drop precisely
// between two existing groups. Existing pins of the same id are
// removed first (move semantics, not duplication).
export function pinAsNewGroupAt(
  pinnedGroups: SidebarTabId[][],
  id: SidebarTabId,
  insertAt: number,
): void {
  const next = pinnedGroups
    .map(g => g.filter(p => p !== id))
    .filter(g => g.length > 0)
  next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, [id])
  useSettingsStore.getState().setPinnedPanels(next)
}

// Add `id` to an existing group at `groupIndex`. If `id` was pinned
// elsewhere, it's moved (removed from its previous group first). When
// removing the previous group leaves the target index pointing at a
// different group than originally intended, we re-anchor via the
// original target group's first remaining member.
export function pinIntoGroup(
  pinnedGroups: SidebarTabId[][],
  id: SidebarTabId,
  groupIndex: number,
): void {
  const next: SidebarTabId[][] = pinnedGroups
    .map(g => g.filter(p => p !== id))
    .filter(g => g.length > 0)
  const targetAnchor = pinnedGroups[groupIndex]?.find(p => p !== id) ?? null
  const realIndex = targetAnchor == null
    ? Math.min(groupIndex, next.length - 1)
    : next.findIndex(g => g.includes(targetAnchor))
  if (realIndex < 0 || realIndex >= next.length) {
    const insertAt = Math.min(groupIndex, next.length)
    next.splice(insertAt, 0, [id])
  } else {
    next[realIndex] = [...next[realIndex], id]
  }
  useSettingsStore.getState().setPinnedPanels(next)
}

// Remove `id` from whatever group it lives in. Empty groups are dropped
// so the stack doesn't leave phantom strips behind.
export function unpinPanel(
  pinnedGroups: SidebarTabId[][],
  id: SidebarTabId,
): void {
  const flat = pinnedGroups.flat()
  if (!flat.includes(id)) return
  const next = pinnedGroups
    .map(g => g.filter(p => p !== id))
    .filter(g => g.length > 0)
  useSettingsStore.getState().setPinnedPanels(next)
}

// Replace ONE group's id list with a new order. Used by intra-strip
// drag-reorder inside a PinnedMiniStrip.
export function reorderGroup(
  pinnedGroups: SidebarTabId[][],
  groupIndex: number,
  newIds: SidebarTabId[],
): void {
  if (groupIndex < 0 || groupIndex >= pinnedGroups.length) return
  if (newIds.length === 0) return
  const next = pinnedGroups.map((g, i) => i === groupIndex ? newIds : g)
  useSettingsStore.getState().setPinnedPanels(next)
}
