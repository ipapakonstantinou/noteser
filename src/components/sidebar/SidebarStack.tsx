'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore, type SidebarTabId, type SidebarGroupState } from '@/stores'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import { InterGroupDropZone } from './InterGroupDropZone'
import { SidebarGroup } from './SidebarGroup'
import { TabContextMenu } from './TabContextMenu'
import {
  KNOWN_IDS,
  TAB_DRAG_MIME,
  type PanelRightClick,
} from './sidebarPanelRegistry'
import {
  createGroupWithTab,
  closeTabInGroup,
  moveTabToNewGroup,
} from './sidebarGroupActions'

interface Props {
  onRightClick: PanelRightClick
}

// Leaf model (2026-06-04): every panel that's currently in the sidebar
// is a tab in a group. Groups stack vertically; each renders its own
// mini-strip + content body. No "floating active unpinned panel" — if
// a panel isn't in any group, it doesn't show.
//
// Activity-bar (Ribbon) handles the icon column on the far left and
// implements the "add panel to last-focused group" logic; this
// component is purely a renderer of the persisted state plus the
// inter-group drop zones for drag-to-new-group.
export const SidebarStack = ({ onRightClick }: Props) => {
  const sidebarGroupsSaved = useSettingsStore(s => s.sidebarGroups)
  const hiddenSidebarTabs = useSettingsStore(s => s.hiddenSidebarTabs)
  const hideSidebarTab = useSettingsStore(s => s.hideSidebarTab)

  // Sanitise persisted groups: drop unknown ids, drop hidden ids,
  // drop empty groups. De-dupe across the stack (a panel can only
  // live in one group). Same semantics the old SidebarStack applied
  // to pinnedPanels, ported to the new shape.
  const hiddenSet = useMemo(() => new Set(hiddenSidebarTabs), [hiddenSidebarTabs])
  const groups = useMemo<SidebarGroupState[]>(() => {
    const seen = new Set<string>()
    const out: SidebarGroupState[] = []
    for (const g of sidebarGroupsSaved) {
      if (!g || !Array.isArray(g.tabs)) continue
      const cleanedTabs: SidebarTabId[] = []
      for (const id of g.tabs) {
        if (KNOWN_IDS.has(id as SidebarTabId) && !seen.has(id) && !hiddenSet.has(id)) {
          seen.add(id)
          cleanedTabs.push(id as SidebarTabId)
        }
      }
      if (cleanedTabs.length === 0) continue
      const activeTab = g.activeTab && cleanedTabs.includes(g.activeTab as SidebarTabId)
        ? (g.activeTab as SidebarTabId)
        : cleanedTabs[0]
      out.push({
        id: g.id,
        tabs: cleanedTabs,
        activeTab,
        collapsed: Boolean(g.collapsed),
      })
    }
    return out
  }, [sidebarGroupsSaved, hiddenSet])

  // Track in-flight drag so inter-group drop zones inflate to a
  // hittable height. Same defensive listeners as the old version —
  // dragend can be skipped on alt-tab / devtools focus, so mouseup
  // + blur also clear the flag.
  const [dragActive, setDragActive] = useState(false)
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

  // Right-click context-menu state for tab-strip icons. One menu
  // instance for the whole sidebar; each group's strip forwards its
  // tab-context-menu requests up here.
  const [tabMenu, setTabMenu] = useState<{
    id: SidebarTabId
    groupId: string
    x: number
    y: number
  } | null>(null)
  const openTabMenu = (id: SidebarTabId, groupId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setTabMenu({ id, groupId, x: e.clientX, y: e.clientY })
  }
  const closeTabMenu = () => setTabMenu(null)

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto" data-testid="sidebar-stack">
      {groups.length === 0 && (
        // Defensive: migration / default should always seed at least
        // one group, but if every panel is hidden the stack ends up
        // empty. Render a helpful prompt instead of a blank pane.
        <div className="p-4 text-sm text-obsidianSecondaryText" data-testid="sidebar-empty">
          No panels in the sidebar. Click an icon in the activity bar to add one.
        </div>
      )}
      {groups.map((g, idx) => (
        <div key={g.id}>
          <InterGroupDropZone
            active={dragActive}
            onDropId={(id) => createGroupWithTab(idx, id)}
          />
          <SidebarGroup
            group={g}
            onTabContextMenu={(id, e) => openTabMenu(id, g.id, e)}
            onRightClick={onRightClick}
          />
        </div>
      ))}
      {/* Trailing zone — drop here to spawn a new group at the very
          bottom of the stack. */}
      {groups.length > 0 && (
        <InterGroupDropZone
          active={dragActive}
          onDropId={(id) => createGroupWithTab(groups.length, id)}
        />
      )}
      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => { closeTabInGroup(tabMenu.groupId, tabMenu.id); closeTabMenu() }}
          onMoveToNewGroup={() => { moveTabToNewGroup(tabMenu.id); closeTabMenu() }}
          onHide={() => { hideSidebarTab(tabMenu.id); closeTabMenu() }}
          onDismiss={closeTabMenu}
        />
      )}
    </div>
  )
}

export default SidebarStack
