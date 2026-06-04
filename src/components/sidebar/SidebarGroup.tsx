'use client'

import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { PinnedMiniStrip } from './PinnedMiniStrip'
import { PANELS, PanelBody, type PanelRightClick } from './sidebarPanelRegistry'
import { useSettingsStore, useUIStore, type SidebarTabId, type SidebarGroupState } from '@/stores'
import { moveTabToGroup } from './sidebarGroupActions'

// One leaf-model group: a horizontal tab strip + the active tab's
// content. Every group renders its OWN strip even when it only holds
// one tab (Obsidian shows the collapse chevron + the single icon).
//
// State (activeTab + collapsed) lives in settingsStore.sidebarGroups
// keyed by the stable group id, so collapse state survives tab moves
// and reorders.
export interface SidebarGroupProps {
  group: SidebarGroupState
  onTabContextMenu: (id: SidebarTabId, e: React.MouseEvent) => void
  onRightClick: PanelRightClick
}

export const SidebarGroup = ({ group, onTabContextMenu, onRightClick }: SidebarGroupProps) => {
  const setGroupActiveTab = useSettingsStore(s => s.setGroupActiveTab)
  const removeTabFromGroup = useSettingsStore(s => s.removeTabFromGroup)
  const setSidebarGroups = useSettingsStore(s => s.setSidebarGroups)
  const setLastFocusedGroupId = useUIStore(s => s.setLastFocusedGroupId)
  const toggleGroupCollapsed = useSettingsStore(s => s.toggleGroupCollapsed)

  const tabs = group.tabs as SidebarTabId[]
  // The persisted activeTab might be stale if tabs[] was just edited
  // externally; fall back to the first tab.
  const activeTab = (group.activeTab && tabs.includes(group.activeTab as SidebarTabId)
    ? group.activeTab
    : tabs[0]) as SidebarTabId

  const activePanelTitle = PANELS.find(p => p.id === activeTab)?.title ?? activeTab
  const isCollapsed = group.collapsed

  const onActivate = (id: SidebarTabId) => {
    setGroupActiveTab(group.id, id)
    setLastFocusedGroupId(group.id)
  }

  // Drop from another group's strip / activity bar → move into this
  // group. The settings store's addTabToGroup handles the move
  // semantics (remove from source, drop empty source group).
  const onAddToThisGroup = (otherId: SidebarTabId) => {
    moveTabToGroup(otherId, group.id)
    setLastFocusedGroupId(group.id)
  }

  return (
    <div
      className="flex-shrink-0 flex flex-col border-t border-obsidianBorder"
      data-testid="sidebar-group"
      data-group-id={group.id}
      data-collapsed={isCollapsed ? 'true' : 'false'}
      onMouseDown={() => setLastFocusedGroupId(group.id)}
    >
      <PinnedMiniStrip
        ids={tabs}
        activeId={activeTab}
        onActivate={onActivate}
        onUnpin={(id) => removeTabFromGroup(group.id, id)}
        onAddToThisGroup={onAddToThisGroup}
        onReorder={(newIds) => {
          // Intra-strip reorder: persist the new tab order on THIS
          // group. We rebuild the whole groups array (immutable update)
          // because individual setters target single-field changes.
          const all = useSettingsStore.getState().sidebarGroups
          setSidebarGroups(all.map(g => g.id === group.id ? { ...g, tabs: newIds } : g))
        }}
        onTabContextMenu={onTabContextMenu}
        leadingSlot={
          <button
            type="button"
            onClick={() => toggleGroupCollapsed(group.id)}
            className="flex items-center justify-center w-5 h-5 rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors flex-none"
            title={isCollapsed ? `Expand ${activePanelTitle}` : `Collapse ${activePanelTitle}`}
            aria-label={isCollapsed ? 'Expand sidebar group' : 'Collapse sidebar group'}
            aria-expanded={!isCollapsed}
            data-testid="sidebar-group-collapse-toggle"
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
          data-testid="sidebar-group-body"
          data-active-panel={activeTab}
        >
          <PanelBody id={activeTab} onRightClick={onRightClick} />
        </div>
      )}
    </div>
  )
}

export default SidebarGroup
