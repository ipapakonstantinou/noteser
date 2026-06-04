'use client'

import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { PinnedMiniStrip } from './PinnedMiniStrip'
import { PANELS, PanelBody, type PanelRightClick } from './sidebarPanelRegistry'
import { useSettingsStore, useUIStore, type SidebarTabId, type SidebarGroupState } from '@/stores'
import { moveTabToGroup, moveTabAcrossSidebars } from './sidebarGroupActions'

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
  // Layout mode set by the stack:
  //   - 'fill'   → flex-1 (fills remaining space). The last expanded
  //                group in the stack always uses this so leftover
  //                vertical space lands somewhere.
  //   - 'fixed'  → height taken from `group.height` (user-resized
  //                or transient draft).
  //   - 'auto'   → no explicit height; flex-shrink-0 so the strip + body
  //                size to content. Used for groups that haven't been
  //                resized yet AND aren't the trailing fill target.
  // When `draftHeight` is set, it overrides group.height for the duration
  // of an in-flight drag (smooth feedback without committing every frame).
  layoutMode?: 'fill' | 'fixed' | 'auto'
  draftHeight?: number
}

export const SidebarGroup = ({
  group, onTabContextMenu, onRightClick, layoutMode = 'auto', draftHeight,
}: SidebarGroupProps) => {
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
  //
  // Cross-sidebar (2026-06-04): if the dropped tab currently lives in
  // a right-side group, route through moveTabAcrossSidebars so it's
  // removed from the right side as part of the same operation.
  const onAddToThisGroup = (otherId: SidebarTabId) => {
    const rightGroups = useSettingsStore.getState().rightSidebarGroups
    const onRight = rightGroups.some(g => g.tabs.includes(otherId))
    if (onRight) {
      moveTabAcrossSidebars(otherId, 'left', group.id)
    } else {
      moveTabToGroup(otherId, group.id)
    }
    setLastFocusedGroupId(group.id)
  }

  // Resolve layout. Collapsed groups always shrink to content (no body
  // is rendered, so explicit height would just leave a vertical gap).
  // Otherwise the layoutMode prop steers between flex-fill and an
  // explicit pixel height.
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
