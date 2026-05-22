'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { SidebarSection } from './SidebarSection'
import { PinnedMiniStrip } from './PinnedMiniStrip'
import { PANELS, PanelBody, type PanelRightClick } from './sidebarPanelRegistry'
import { type SidebarTabId } from '@/stores'
import { useSettingsStore } from '@/stores'

// A pinned GROUP: a mini tab strip (one or more icons) + the active
// tab's content below. Single-icon strips look like a labelled
// pinned panel; multi-icon strips behave like a tiny tab switcher.
//
// State that's local to the group: which tab is active (defaults to
// the first id). We hold it inside the component because group
// composition is keyed on `group.join(',')` from the parent, so
// adding/removing members remounts and naturally resets to a sane
// default.
//
// Collapse state IS persisted (settings store keys on the same
// `group.join(',')`), so a hidden panel stays hidden across reloads.
// When the group composition changes, the key changes too — the old
// collapse entry is silently ignored and the new group starts expanded.
export interface PinnedGroupProps {
  group: SidebarTabId[]
  onUnpin: (id: SidebarTabId) => void
  // The parent uses this to ADD a tab into this group. Called from
  // the mini-strip's drop handler when a tab is dragged from
  // elsewhere onto this group's strip.
  onAddToThisGroup: (id: SidebarTabId) => void
  // Intra-strip reorder — passes a fresh id array for THIS group.
  onReorder: (newIds: SidebarTabId[]) => void
  onRightClick: PanelRightClick
  // Right-click on a mini-strip icon — routed to SidebarStack so the
  // TabContextMenu is rendered at a single instance level.
  onTabContextMenu: (id: SidebarTabId, e: React.MouseEvent) => void
}

export const PinnedGroup = ({
  group, onUnpin, onAddToThisGroup, onReorder, onRightClick, onTabContextMenu,
}: PinnedGroupProps) => {
  const [activeTab, setActiveTab] = useState<SidebarTabId>(group[0])
  // If the group composition changed and the previous active tab is
  // gone, snap to the first available.
  const safeActive = group.includes(activeTab) ? activeTab : group[0]

  const groupKey = group.join(',')
  const isCollapsed = useSettingsStore(s => s.collapsedPinnedGroups.includes(groupKey))
  const toggleCollapsed = useSettingsStore(s => s.togglePinnedGroupCollapsed)

  const activePanelTitle = PANELS.find(p => p.id === safeActive)?.title ?? safeActive

  return (
    <div className="flex-shrink-0 flex flex-col border-t border-obsidianBorder" data-testid="pinned-group" data-collapsed={isCollapsed ? 'true' : 'false'}>
      <PinnedMiniStrip
        ids={group}
        activeId={safeActive}
        onActivate={setActiveTab}
        onUnpin={onUnpin}
        onAddToThisGroup={onAddToThisGroup}
        onReorder={onReorder}
        onTabContextMenu={onTabContextMenu}
        leadingSlot={
          <button
            type="button"
            onClick={() => toggleCollapsed(groupKey)}
            className="flex items-center justify-center w-5 h-5 rounded text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText transition-colors flex-none"
            title={isCollapsed ? `Expand ${activePanelTitle}` : `Collapse ${activePanelTitle}`}
            aria-label={isCollapsed ? 'Expand pinned panel' : 'Collapse pinned panel'}
            aria-expanded={!isCollapsed}
            data-testid="pinned-group-collapse-toggle"
          >
            {isCollapsed
              ? <ChevronRightIcon className="w-3.5 h-3.5" />
              : <ChevronDownIcon className="w-3.5 h-3.5" />}
          </button>
        }
      />
      {/* No onHeaderContextMenu here: SidebarSection forwards that to
          the CONTENT wrapper when hideHeader=true, which means a
          right-click anywhere inside the panel body (e.g. on a folder
          row in the Files tree) bubbles up and unpins the panel back
          to the bottom strip. Reported via Telegram 2026-05-21. The
          mini-strip icon's right-click already covers unpin. */}
      {!isCollapsed && (
        <SidebarSection
          id={safeActive}
          title={activePanelTitle}
          hideHeader={true}
        >
          <PanelBody id={safeActive} onRightClick={onRightClick} />
        </SidebarSection>
      )}
    </div>
  )
}
