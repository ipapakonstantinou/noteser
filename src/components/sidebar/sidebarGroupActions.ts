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

// Activity-bar click handler. Implements the four cases from the spec:
//   1. `tabId` is the activeTab of some group → focus the sidebar
//      (uncollapse if collapsed), no state change otherwise.
//   2. `tabId` is a non-active tab in some group → set that group's
//      activeTab, open sidebar.
//   3. `tabId` is NOT in any group → add to the LAST-focused group's
//      tabs and set it as active. Fall back to the LAST group in the
//      stack when no group has been focused yet (fresh boot).
//   4. `tabId` is in `hiddenSidebarTabs` → unhide it AND apply rule 3.
//
// All four cases also open the sidebar if it's collapsed, matching
// Obsidian's behaviour ("click ribbon icon → sidebar wakes up").
export function activatePanelFromActivityBar(tabId: SidebarTabId): void {
  const settings = useSettingsStore.getState()
  const ui = useUIStore.getState()
  const groups = settings.sidebarGroups

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
    // Case 1 or 2: tab already in a group somewhere.
    if (owner.activeTab !== tabId) {
      settings.setGroupActiveTab(owner.id, tabId)
    }
    ui.setLastFocusedGroupId(owner.id)
    if (ui.sidebarCollapsed) ui.toggleSidebar()
    return
  }

  // Case 3 (and 4): tab not in any group → add to last-focused or
  // bottom-most group. If the stack is empty (theoretically — the
  // default seeds at least one group, and migrations fall back too)
  // create a fresh group instead so we never silently swallow a click.
  if (updatedGroups.length === 0) {
    settings.createGroupAt(0, tabId)
  } else {
    const target =
      updatedGroups.find(g => g.id === ui.lastFocusedGroupId)
      ?? updatedGroups[updatedGroups.length - 1]
    settings.addTabToGroup(target.id, tabId)
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

// Re-export the id factory + state type so call sites can build groups
// without importing from the store directly. Keeps the import surface
// in components/sidebar/* tight.
export { newSidebarGroupId, type SidebarGroupState }
