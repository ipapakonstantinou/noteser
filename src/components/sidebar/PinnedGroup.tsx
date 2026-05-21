'use client'

import { useState } from 'react'
import { SidebarSection } from './SidebarSection'
import { PinnedMiniStrip } from './PinnedMiniStrip'
import { PANELS, PanelBody, type PanelRightClick } from './sidebarPanelRegistry'
import { type SidebarTabId } from '@/stores'

// A pinned GROUP: a mini tab strip (one or more icons) + the active
// tab's content below. Single-icon strips look like a labelled
// pinned panel; multi-icon strips behave like a tiny tab switcher.
//
// State that's local to the group: which tab is active (defaults to
// the first id). We hold it inside the component because group
// composition is keyed on `group.join(',')` from the parent, so
// adding/removing members remounts and naturally resets to a sane
// default.
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
}

export const PinnedGroup = ({
  group, onUnpin, onAddToThisGroup, onReorder, onRightClick,
}: PinnedGroupProps) => {
  const [activeTab, setActiveTab] = useState<SidebarTabId>(group[0])
  // If the group composition changed and the previous active tab is
  // gone, snap to the first available.
  const safeActive = group.includes(activeTab) ? activeTab : group[0]
  return (
    <div className="flex-shrink-0 flex flex-col border-t border-obsidianBorder">
      <PinnedMiniStrip
        ids={group}
        activeId={safeActive}
        onActivate={setActiveTab}
        onUnpin={onUnpin}
        onAddToThisGroup={onAddToThisGroup}
        onReorder={onReorder}
      />
      {/* No onHeaderContextMenu here: SidebarSection forwards that to
          the CONTENT wrapper when hideHeader=true, which means a
          right-click anywhere inside the panel body (e.g. on a folder
          row in the Files tree) bubbles up and unpins the panel back
          to the bottom strip. Reported via Telegram 2026-05-21. The
          mini-strip icon's right-click already covers unpin. */}
      <SidebarSection
        id={safeActive}
        title={PANELS.find(p => p.id === safeActive)?.title ?? safeActive}
        hideHeader={true}
      >
        <PanelBody id={safeActive} onRightClick={onRightClick} />
      </SidebarSection>
    </div>
  )
}
