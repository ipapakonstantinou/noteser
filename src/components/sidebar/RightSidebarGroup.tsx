'use client'

import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { RightMiniStrip } from './RightMiniStrip'
import {
  RightPanelBody,
  rightPanelDef,
  type RightSidebarTabId,
} from './rightPanelRegistry'
import { useSettingsStore, useUIStore, type SidebarGroupState } from '@/stores'
import { moveTabToRightGroup } from './rightSidebarGroupActions'
import { moveTabAcrossSidebars } from './sidebarGroupActions'

// Right-side leaf-model group — mirror of `SidebarGroup` but bound to
// the right-side registry + setters. Same chrome (strip + chevron +
// body) so the two sidebars stay visually symmetrical.
export interface RightSidebarGroupProps {
  group: SidebarGroupState
  onTabContextMenu: (id: RightSidebarTabId, e: React.MouseEvent) => void
  layoutMode?: 'fill' | 'fixed' | 'auto'
  draftHeight?: number
}

export const RightSidebarGroup = ({
  group, onTabContextMenu, layoutMode = 'auto', draftHeight,
}: RightSidebarGroupProps) => {
  const setRightGroupActiveTab = useSettingsStore(s => s.setRightGroupActiveTab)
  const setRightSidebarGroups = useSettingsStore(s => s.setRightSidebarGroups)
  const setLastFocusedRightGroupId = useUIStore(s => s.setLastFocusedRightGroupId)
  const toggleRightGroupCollapsed = useSettingsStore(s => s.toggleRightGroupCollapsed)

  const tabs = group.tabs as RightSidebarTabId[]
  const activeTab = (group.activeTab && tabs.includes(group.activeTab as RightSidebarTabId)
    ? group.activeTab
    : tabs[0]) as RightSidebarTabId

  const activePanelTitle = rightPanelDef(activeTab)?.title ?? activeTab
  const isCollapsed = group.collapsed

  const onActivate = (id: RightSidebarTabId) => {
    setRightGroupActiveTab(group.id, id)
    setLastFocusedRightGroupId(group.id)
  }

  // Drop into this right-side group. Cross-sidebar (2026-06-04): if
  // the dropped tab currently lives in a left-side group, route
  // through moveTabAcrossSidebars so it's evicted from the left side
  // as part of the same operation.
  const onAddToThisGroup = (otherId: RightSidebarTabId) => {
    const leftGroups = useSettingsStore.getState().sidebarGroups
    const onLeft = leftGroups.some(g => g.tabs.includes(otherId))
    if (onLeft) {
      moveTabAcrossSidebars(otherId, 'right', group.id)
    } else {
      moveTabToRightGroup(otherId, group.id)
    }
    setLastFocusedRightGroupId(group.id)
  }

  const explicitHeight = !isCollapsed && layoutMode === 'fixed'
    ? (draftHeight ?? group.height ?? undefined)
    : undefined
  const wrapperClass = !isCollapsed && layoutMode === 'fill'
    ? 'flex-1 min-h-0 flex flex-col border-t border-obsidianBorder'
    : 'flex-shrink-0 flex flex-col border-t border-obsidianBorder'

  return (
    <div
      className={wrapperClass}
      style={explicitHeight != null ? { height: explicitHeight } : undefined}
      data-testid="right-sidebar-group"
      data-group-id={group.id}
      data-collapsed={isCollapsed ? 'true' : 'false'}
      onMouseDown={() => setLastFocusedRightGroupId(group.id)}
    >
      <RightMiniStrip
        ids={tabs}
        activeId={activeTab}
        onActivate={onActivate}
        onAddToThisGroup={onAddToThisGroup}
        onReorder={(newIds) => {
          const all = useSettingsStore.getState().rightSidebarGroups
          setRightSidebarGroups(all.map(g => g.id === group.id ? { ...g, tabs: newIds } : g))
        }}
        onTabContextMenu={onTabContextMenu}
        leadingSlot={
          <button
            type="button"
            onClick={() => toggleRightGroupCollapsed(group.id)}
            className="flex items-center justify-center w-5 h-5 rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors flex-none"
            title={isCollapsed ? `Expand ${activePanelTitle}` : `Collapse ${activePanelTitle}`}
            aria-label={isCollapsed ? 'Expand right sidebar group' : 'Collapse right sidebar group'}
            aria-expanded={!isCollapsed}
            data-testid="right-sidebar-group-collapse-toggle"
          >
            {isCollapsed
              ? <ChevronRightIcon className="w-3.5 h-3.5" />
              : <ChevronDownIcon className="w-3.5 h-3.5" />}
          </button>
        }
      />
      {!isCollapsed && (
        <div
          className="flex-1 min-h-0 overflow-y-auto"
          data-testid="right-sidebar-group-body"
          data-active-panel={activeTab}
          role="tabpanel"
          id={`right-sidebar-tabpanel-${activeTab}`}
          aria-labelledby={`right-sidebar-tab-${activeTab}`}
        >
          <RightPanelBody id={activeTab} />
        </div>
      )}
    </div>
  )
}

export default RightSidebarGroup
