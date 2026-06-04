// Right-sidebar leaf-model action helpers — mirror of
// `sidebarGroupActions.ts` but targeting the RIGHT-side stores
// (`settingsStore.rightSidebarGroups`, `uiStore.lastFocusedRightGroupId`,
// `uiStore.rightSidebarCollapsed`). Separated so right-side panels
// don't accidentally leak into left-side state (and vice versa) when
// the activity-bar click handlers fire.

import { useSettingsStore, useUIStore, type SidebarGroupState } from '@/stores'
import type { RightSidebarTabId } from './rightPanelRegistry'

export function findRightGroupWithTab(
  groups: SidebarGroupState[],
  tabId: RightSidebarTabId,
): SidebarGroupState | null {
  for (const g of groups) {
    if (g.tabs.includes(tabId)) return g
  }
  return null
}

// Right-side equivalent of `activatePanelFromActivityBar` — same four
// cases (in-group + active = focus, in-group + inactive = make active,
// not-in-group = replace focused group's activeTab). Hidden-tab case 4
// from the left side is omitted because the right sidebar has no
// hidden-tabs list (the right registry is small enough that hiding
// would be more confusing than useful).
export function activateRightPanelFromActivityBar(tabId: RightSidebarTabId): void {
  const settings = useSettingsStore.getState()
  const ui = useUIStore.getState()

  const owner = findRightGroupWithTab(settings.rightSidebarGroups, tabId)
  if (owner) {
    if (owner.activeTab !== tabId) {
      settings.setRightGroupActiveTab(owner.id, tabId)
    }
    ui.setLastFocusedRightGroupId(owner.id)
    if (ui.rightSidebarCollapsed) ui.setRightSidebarCollapsed(false)
    return
  }

  if (settings.rightSidebarGroups.length === 0) {
    settings.createRightGroupAt(0, tabId)
  } else {
    const target =
      settings.rightSidebarGroups.find(g => g.id === ui.lastFocusedRightGroupId)
      ?? settings.rightSidebarGroups[settings.rightSidebarGroups.length - 1]
    const oldActive = target.activeTab
    const groups = useSettingsStore.getState().rightSidebarGroups
    settings.setRightSidebarGroups(groups.map(g => {
      if (g.id !== target.id) return g
      const tabs = g.tabs.filter(t => t !== oldActive).concat(tabId)
      return { ...g, tabs, activeTab: tabId }
    }))
    ui.setLastFocusedRightGroupId(target.id)
  }
  if (ui.rightSidebarCollapsed) ui.setRightSidebarCollapsed(false)
}

export function moveTabToRightGroup(tabId: RightSidebarTabId, targetGroupId: string): void {
  useSettingsStore.getState().addTabToRightGroup(targetGroupId, tabId)
}

export function createRightGroupWithTab(insertAt: number, tabId: RightSidebarTabId): void {
  useSettingsStore.getState().createRightGroupAt(insertAt, tabId)
}

export function closeTabInRightGroup(groupId: string, tabId: RightSidebarTabId): void {
  useSettingsStore.getState().removeTabFromRightGroup(groupId, tabId)
}

export function moveTabToNewRightGroup(tabId: RightSidebarTabId): void {
  const groups = useSettingsStore.getState().rightSidebarGroups
  const owner = findRightGroupWithTab(groups, tabId)
  const sourceIdx = owner ? groups.findIndex(g => g.id === owner.id) : -1
  const insertAt = sourceIdx >= 0 ? sourceIdx + 1 : groups.length
  useSettingsStore.getState().createRightGroupAt(insertAt, tabId)
}
