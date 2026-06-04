'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore, useUIStore, type SidebarTabId } from '@/stores'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import { InterGroupDropZone } from './InterGroupDropZone'
import { PinnedGroup } from './PinnedGroup'
import { TabContextMenu, type TabContextMenuLocation } from './TabContextMenu'
import {
  KNOWN_IDS,
  PanelBody,
  TAB_DRAG_MIME,
  resolveTabOrder,
  type PanelRightClick,
} from './sidebarPanelRegistry'
import {
  pinAsNewGroup,
  pinAsNewGroupAt,
  pinIntoGroup,
  unpinPanel,
  reorderGroup,
} from './pinningActions'

// Re-export resolveTabOrder so older callers (the unit test, future
// consumers) keep their existing `from './SidebarStack'` import path.
export { resolveTabOrder }

interface Props {
  onRightClick: PanelRightClick
}

export const SidebarStack = ({ onRightClick }: Props) => {
  const pinnedSaved = useSettingsStore(s => s.pinnedPanels)
  const tabOrderSaved = useSettingsStore(s => s.sidebarTabOrder)
  const hiddenSidebarTabs = useSettingsStore(s => s.hiddenSidebarTabs)
  const hideSidebarTab = useSettingsStore(s => s.hideSidebarTab)
  const activeSidebarTabId = useUIStore(s => s.sidebarTabId)

  // Hidden-tab filter: any id the user has hidden via right-click is
  // dropped from BOTH the pinned strips and the unpinned panel body
  // at render time. Settings → Sidebar exposes the unhide UI.
  const hiddenSet = useMemo(() => new Set(hiddenSidebarTabs), [hiddenSidebarTabs])

  // Sanitise pinnedPanels: outer array = groups, each inner array =
  // tabs in that group. Drop unknown ids, drop empty groups, de-dupe
  // across groups (a panel can only live in one place), drop hidden
  // ids. Returns SidebarTabId[][].
  const pinnedGroups = useMemo<SidebarTabId[][]>(() => {
    const seen = new Set<string>()
    const out: SidebarTabId[][] = []
    for (const group of pinnedSaved) {
      if (!Array.isArray(group)) continue
      const cleaned: SidebarTabId[] = []
      for (const id of group) {
        if (KNOWN_IDS.has(id as SidebarTabId) && !seen.has(id) && !hiddenSet.has(id)) {
          seen.add(id)
          cleaned.push(id as SidebarTabId)
        }
      }
      if (cleaned.length > 0) out.push(cleaned)
    }
    return out
  }, [pinnedSaved, hiddenSet])

  // Flat list of every pinned id — handy for resolveTabOrder + lookup.
  const pinnedFlat = useMemo<SidebarTabId[]>(
    () => pinnedGroups.flat(),
    [pinnedGroups],
  )

  // Unpinned tab order — same merger as the old TabSwitcher used. The
  // ActivityBar (Ribbon) handles the icon row; this component just
  // renders the body of whichever unpinned panel is active.
  const unpinnedIds = useMemo<SidebarTabId[]>(
    () => resolveTabOrder(tabOrderSaved, pinnedFlat).filter(id => !hiddenSet.has(id)),
    [tabOrderSaved, pinnedFlat, hiddenSet],
  )
  // If the active tab is currently pinned (so its body lives inside a
  // pinned group above), fall back to the first unpinned id so the
  // bottom area isn't blank.
  const effectiveTabId: SidebarTabId | null = pinnedFlat.includes(activeSidebarTabId)
    ? (unpinnedIds[0] ?? null)
    : activeSidebarTabId

  // Track whether a sidebar drag is in flight. Used to inflate the
  // inter-group drop zones so the user can hit them more easily. Window-
  // level dragstart / dragend listener so we react regardless of which
  // child started the drag.
  //
  // Defensive: HTML5 dnd can drop dragend if the user releases the
  // drag outside the browser (window blur, alt-tab, devtools focus,
  // etc.). When that happens the dragActive flag gets stuck true and
  // the drop bars stick around. We layer extra clears on `mouseup`
  // and `blur` so any mouse release / window de-focus also resets it.
  const [dragActive, setDragActive] = useState(false)

  // Right-click context-menu state for pinned-strip tab icons. The
  // ActivityBar handles its own icon clicks directly (drag-to-pin /
  // drag-to-unpin); only the in-group PinnedMiniStrip routes through
  // here for per-tab Unpin / Hide.
  const [tabMenu, setTabMenu] = useState<{
    id: SidebarTabId
    x: number
    y: number
    location: TabContextMenuLocation
  } | null>(null)
  const openTabMenu = (id: SidebarTabId, e: React.MouseEvent, location: TabContextMenuLocation) => {
    e.preventDefault()
    e.stopPropagation()
    setTabMenu({ id, x: e.clientX, y: e.clientY, location })
  }
  const closeTabMenu = () => setTabMenu(null)
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      const t = e.dataTransfer?.types
      if (!t) return
      if (t.includes(TAB_DRAG_MIME) || t.includes(SIDEBAR_PANEL_DRAG_MIME)) {
        setDragActive(true)
      }
    }
    const onEnd = () => setDragActive(false)
    window.addEventListener('dragstart', onStart)
    window.addEventListener('dragend', onEnd)
    window.addEventListener('drop', onEnd)
    // Belt-and-braces: mouseup outside a drop zone, or the window
    // losing focus, also clears the flag. Both are guaranteed to
    // fire even when dragend doesn't.
    window.addEventListener('mouseup', onEnd)
    window.addEventListener('blur', onEnd)
    return () => {
      window.removeEventListener('dragstart', onStart)
      window.removeEventListener('dragend', onEnd)
      window.removeEventListener('drop', onEnd)
      window.removeEventListener('mouseup', onEnd)
      window.removeEventListener('blur', onEnd)
    }
  }, [])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Scrollable pinned area — lets the user stack arbitrarily
          many groups without crowding out the active panel below.
          max-h-[60%] caps it so the lower area stays reachable;
          internal scroll handles the rest. */}
      {pinnedGroups.length > 0 && (
        <div className="flex-shrink min-h-0 overflow-y-auto" style={{ maxHeight: '60%' }}>
          {pinnedGroups.map((group, groupIndex) => (
            <div key={group.join(',')}>
              {/* Inter-group drop zone ABOVE this group. During drag
                  it's tall + visibly highlighted; otherwise zero-height. */}
              <InterGroupDropZone
                active={dragActive}
                onDropId={(id) => pinAsNewGroupAt(pinnedGroups, id, groupIndex)}
              />
              <PinnedGroup
                group={group}
                onUnpin={(id) => unpinPanel(pinnedGroups, id)}
                onAddToThisGroup={(otherId) => pinIntoGroup(pinnedGroups, otherId, groupIndex)}
                onReorder={(newIds) => reorderGroup(pinnedGroups, groupIndex, newIds)}
                onRightClick={onRightClick}
                onTabContextMenu={(id, e) => openTabMenu(id, e, 'pinned')}
              />
            </div>
          ))}
          {/* Trailing zone — insert a new group at the end. */}
          <InterGroupDropZone
            active={dragActive}
            onDropId={(id) => pinAsNewGroupAt(pinnedGroups, id, pinnedGroups.length)}
          />
        </div>
      )}
      {/* When there are no pinned groups yet, render a single drop
          zone ABOVE the unpinned panel body so users can pin via a
          drag-up from the ActivityBar's unpinned icons. Inactive
          height collapses to zero, so no extra padding when no drag
          is in flight. */}
      {pinnedGroups.length === 0 && (
        <InterGroupDropZone
          active={dragActive}
          onDropId={(id) => pinAsNewGroupAt(pinnedGroups, id, 0)}
        />
      )}
      {/* Active unpinned panel body. The icon strip lives in the
          ActivityBar now (formerly Ribbon); this is just the content
          surface. border-t keeps the visual separation from any
          pinned group above. */}
      {effectiveTabId && (
        <div
          className="flex-1 min-h-0 flex flex-col border-t border-obsidianBorder"
          data-testid="sidebar-active-panel"
          data-panel-id={effectiveTabId}
        >
          <div className="flex-1 min-h-0 overflow-y-auto">
            <PanelBody id={effectiveTabId} onRightClick={onRightClick} />
          </div>
        </div>
      )}
      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          location={tabMenu.location}
          onPin={() => { pinAsNewGroup(pinnedGroups, tabMenu.id); closeTabMenu() }}
          onUnpin={() => { unpinPanel(pinnedGroups, tabMenu.id); closeTabMenu() }}
          onHide={() => { hideSidebarTab(tabMenu.id); closeTabMenu() }}
          onClose={closeTabMenu}
        />
      )}
    </div>
  )
}

export default SidebarStack
