// Sidebar leaf-model action helpers.
//
// Replaces the previous pinningActions.ts (pin/unpin/group) that
// targeted the old `pinnedPanels: string[][]` shape. The new shape is
// `sidebarGroups: SidebarGroupState[]`, where each group has a stable
// id, a tabs[] array, an activeTab, and a collapsed flag.
//
// Most of the heavy lifting lives directly on the settings store
// (addTabToGroup, removeTabFromGroup, createGroupAt, …). These wrappers
// exist so call sites (Ribbon, SidebarGroup, drop zones) read top-to-
// bottom without dipping into useSettingsStore.getState() boilerplate,
// and so the activity-bar 4-case click logic has one canonical home.

import { useSettingsStore, useUIStore, type SidebarTabId, type SidebarGroupState, newSidebarGroupId } from '@/stores'
import { applyAddTabToGroup, applyRemoveTabFromGroup, applyCreateGroupAt } from '@/stores/settingsStore'

// Find which group (if any) currently contains `tabId`. Returns the
// group object or null. Pure — does not touch the store.
export function findGroupWithTab(
  groups: SidebarGroupState[],
  tabId: SidebarTabId,
): SidebarGroupState | null {
  for (const g of groups) {
    if (g.tabs.includes(tabId)) return g
  }
  return null
}

// Activity-bar click handler. Per user feedback (2026-06-04), clicking
// an activity-bar icon switches the FOCUSED group's active panel — it
// does NOT add a tab alongside existing ones (which was the previous
// Obsidian-add semantic). The user expects "VS Code switch" behaviour:
// click an icon, see THAT panel, the previous one steps out of the way.
//
// Concretely, the four cases are now:
//   1. `tabId` is the activeTab of some group → focus the sidebar
//      (uncollapse if collapsed), no other state change.
//   2. `tabId` is a non-active tab in some group → set that group's
//      activeTab to `tabId`, focus the sidebar.
//   3. `tabId` is NOT in any group → REPLACE the focused group's
//      activeTab with this tab. The previously-active panel is
//      removed from the group entirely (returns to the activity bar).
//      Other tabs in the group remain.
//   4. `tabId` is in `hiddenSidebarTabs` → unhide it AND apply rule 3.
//
// All four cases open the sidebar if it's collapsed.
export function activatePanelFromActivityBar(tabId: SidebarTabId): void {
  const settings = useSettingsStore.getState()
  const ui = useUIStore.getState()

  // Case 4 first: an id may live in `hiddenSidebarTabs` (in which case
  // it's filtered out of every group by hideSidebarTab itself, so the
  // findGroupWithTab below would also miss it). Unhide synchronously
  // so the downstream lookup runs against the updated state.
  if (settings.hiddenSidebarTabs.includes(tabId)) {
    settings.showSidebarTab(tabId)
  }

  // Re-read after the potential showSidebarTab — its set() is sync.
  const updatedGroups = useSettingsStore.getState().sidebarGroups
  const owner = findGroupWithTab(updatedGroups, tabId)

  if (owner) {
    // Case 1 or 2: tab already in a group somewhere → just focus it.
    if (owner.activeTab !== tabId) {
      settings.setGroupActiveTab(owner.id, tabId)
    }
    ui.setLastFocusedGroupId(owner.id)
    if (ui.sidebarCollapsed) ui.toggleSidebar()
    return
  }

  // Case 3 (and 4): tab not in any group → REPLACE focused group's
  // activeTab with this id. Falls back to the last group in the stack
  // when nothing has been focused yet. If the stack is empty, create
  // a fresh group instead so we never silently swallow a click.
  if (updatedGroups.length === 0) {
    settings.createGroupAt(0, tabId)
  } else {
    const target =
      updatedGroups.find(g => g.id === ui.lastFocusedGroupId)
      ?? updatedGroups[updatedGroups.length - 1]
    const oldActive = target.activeTab
    // Compute the new tab list: filter out the old active, append the
    // new one. Then commit both the tab list AND the activeTab via the
    // settings store. setSidebarGroups is the cheapest one-shot setter
    // for "replace this group wholesale".
    const groups = useSettingsStore.getState().sidebarGroups
    settings.setSidebarGroups(groups.map(g => {
      if (g.id !== target.id) return g
      const tabs = g.tabs.filter(t => t !== oldActive).concat(tabId)
      return { ...g, tabs, activeTab: tabId }
    }))
    ui.setLastFocusedGroupId(target.id)
  }
  if (ui.sidebarCollapsed) ui.toggleSidebar()
}

// Cross-group move. Calls addTabToGroup which already includes
// move semantics (remove from previous group, drop empty groups).
export function moveTabToGroup(tabId: SidebarTabId, targetGroupId: string): void {
  useSettingsStore.getState().addTabToGroup(targetGroupId, tabId)
}

// Inter-group drop zone → spawn a brand-new group at the requested
// index. Thin wrapper for symmetry with the other helpers.
export function createGroupWithTab(insertAt: number, tabId: SidebarTabId): void {
  useSettingsStore.getState().createGroupAt(insertAt, tabId)
}

// Close (= remove) `tabId` from `groupId`. If the group's last tab was
// removed, the group is dropped entirely. Bound to the right-click
// "Close" menu action.
export function closeTabInGroup(groupId: string, tabId: SidebarTabId): void {
  useSettingsStore.getState().removeTabFromGroup(groupId, tabId)
}

// Bound to the right-click "Move to new group" action. Yanks the tab
// from its current group and creates a new singleton group AFTER the
// source group's position. Falls back to the end of the stack when
// the source group isn't found (defensive).
export function moveTabToNewGroup(tabId: SidebarTabId): void {
  const groups = useSettingsStore.getState().sidebarGroups
  const owner = findGroupWithTab(groups, tabId)
  const sourceIdx = owner ? groups.findIndex(g => g.id === owner.id) : -1
  const insertAt = sourceIdx >= 0 ? sourceIdx + 1 : groups.length
  useSettingsStore.getState().createGroupAt(insertAt, tabId)
}

// Cross-sidebar move (2026-06-04). Yanks `tabId` out of whichever
// side currently owns it (left `sidebarGroups` or right
// `rightSidebarGroups`) and drops it onto the other side. The drop
// destination is one of:
//
//   • `targetGroupId` non-null → add to that existing group on the
//     `targetSide`. Uses applyAddTabToGroup so the activeTab flips
//     to the moved tab automatically.
//   • `targetGroupId` null + `insertAt` provided → spawn a brand-new
//     group on the target side at that index. Uses applyCreateGroupAt
//     which already de-dupes the same tab out of every other group on
//     the target side.
//
// Both store writes happen in one set() pass — the helper reads the
// current state, computes the next snapshot for each side, then commits
// both in a single setState. Atomic from the React/Zustand perspective:
// subscribers see either both writes or neither.
//
// No-op when the tab isn't on the OTHER side (use moveTabToGroup /
// createGroupWithTab / the right-side equivalents for same-side moves).
export function moveTabAcrossSidebars(
  tabId: string,
  targetSide: 'left' | 'right',
  targetGroupId: string | null,
  insertAt?: number,
): void {
  const state = useSettingsStore.getState()
  const sourceSide = targetSide === 'left' ? 'right' : 'left'
  const sourceGroups = sourceSide === 'left' ? state.sidebarGroups : state.rightSidebarGroups
  const owner = sourceGroups.find(g => g.tabs.includes(tabId))
  if (!owner) return // not on the other side — nothing to move

  // Remove from source side first.
  const nextSourceGroups = applyRemoveTabFromGroup(sourceGroups, owner.id, tabId)

  // Add to target side.
  const targetGroups = targetSide === 'left' ? state.sidebarGroups : state.rightSidebarGroups
  let nextTargetGroups: SidebarGroupState[]
  if (targetGroupId != null) {
    // Drop into an existing target group. The target side may not have
    // had this tab before, so applyAddTabToGroup handles the append +
    // makes it active.
    nextTargetGroups = applyAddTabToGroup(targetGroups, targetGroupId, tabId)
  } else {
    const idx = typeof insertAt === 'number' ? insertAt : targetGroups.length
    nextTargetGroups = applyCreateGroupAt(targetGroups, idx, tabId)
  }

  // Commit both sides in a single setState so subscribers see the
  // post-move world in one render pass.
  if (targetSide === 'left') {
    useSettingsStore.setState({
      sidebarGroups: nextTargetGroups,
      rightSidebarGroups: nextSourceGroups,
    })
    useUIStore.getState().setLastFocusedGroupId(
      targetGroupId ?? (nextTargetGroups.find(g => g.tabs.includes(tabId))?.id ?? null),
    )
  } else {
    useSettingsStore.setState({
      sidebarGroups: nextSourceGroups,
      rightSidebarGroups: nextTargetGroups,
    })
    useUIStore.getState().setLastFocusedRightGroupId(
      targetGroupId ?? (nextTargetGroups.find(g => g.tabs.includes(tabId))?.id ?? null),
    )
  }
}

// Helper used by drop handlers: is `tabId` currently in any group on
// the OTHER side? Pure — does not touch the store. The caller decides
// the source by passing in the right-side groups array.
export function findRightGroupWithTabFromLeft(
  rightGroups: SidebarGroupState[],
  tabId: string,
): SidebarGroupState | null {
  for (const g of rightGroups) {
    if (g.tabs.includes(tabId)) return g
  }
  return null
}

// Re-export the id factory + state type so call sites can build groups
// without importing from the store directly. Keeps the import surface
// in components/sidebar/* tight.
export { newSidebarGroupId, type SidebarGroupState }
