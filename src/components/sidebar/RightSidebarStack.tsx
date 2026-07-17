'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSettingsStore, type SidebarGroupState } from '@/stores'
import {
  RIGHT_KNOWN_IDS,
  RIGHT_TAB_DRAG_MIME,
  type RightSidebarTabId,
} from './rightPanelRegistry'
import { RightInterGroupDropZone } from './RightInterGroupDropZone'
import { RightSidebarGroup } from './RightSidebarGroup'
import { GroupResizeHandle } from './GroupResizeHandle'
import { TabContextMenu } from './TabContextMenu'
import {
  createRightGroupWithTab,
  closeTabInRightGroup,
  moveTabToNewRightGroup,
} from './rightSidebarGroupActions'
import { moveTabAcrossSidebars } from './sidebarGroupActions'

// Right-side stack — mirror of `SidebarStack`. Renders the right
// sidebar's stacked groups plus inter-group drop zones (drag a panel
// from the right ribbon onto a zone → new group at that index) and
// inter-group resize handles (drag the divider to redistribute
// vertical space between adjacent groups).
//
// No "hidden right-side tabs" filter — the right registry is small
// enough that hiding individual panels is more confusing than useful.
// Adding one later is a small change (mirror the left's hiddenSidebarTabs
// pattern + the showing menu in TabContextMenu).
export const RightSidebarStack = () => {
  const rightGroupsSaved = useSettingsStore(s => s.rightSidebarGroups)
  const setRightGroupHeight = useSettingsStore(s => s.setRightGroupHeight)

  // Sanitise: drop unknown ids, drop empty groups, de-dupe.
  const groups = useMemo<SidebarGroupState[]>(() => {
    const seen = new Set<string>()
    const out: SidebarGroupState[] = []
    for (const g of rightGroupsSaved) {
      if (!g || !Array.isArray(g.tabs)) continue
      const cleanedTabs: RightSidebarTabId[] = []
      for (const id of g.tabs) {
        // RIGHT_KNOWN_IDS now spans every left + right panel id so a
        // cross-sidebar drag from the left activity bar (e.g. Plugins)
        // lands cleanly on the right without being filtered out here.
        if (RIGHT_KNOWN_IDS.has(id) && !seen.has(id)) {
          seen.add(id)
          cleanedTabs.push(id as RightSidebarTabId)
        }
      }
      if (cleanedTabs.length === 0) continue
      const activeTab = g.activeTab && cleanedTabs.includes(g.activeTab as RightSidebarTabId)
        ? (g.activeTab as RightSidebarTabId)
        : cleanedTabs[0]
      out.push({
        id: g.id,
        tabs: cleanedTabs,
        activeTab,
        collapsed: Boolean(g.collapsed),
        height: g.height ?? null,
      })
    }
    return out
  }, [rightGroupsSaved])

  // Inflate drop zones during a right-side drag.
  const [dragActive, setDragActive] = useState(false)
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      const t = e.dataTransfer?.types
      if (!t) return
      if (t.includes(RIGHT_TAB_DRAG_MIME)) setDragActive(true)
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
      window.removeEventListener('blur-sm', onEnd)
    }
  }, [])

  const [tabMenu, setTabMenu] = useState<{
    id: RightSidebarTabId
    groupId: string
    x: number
    y: number
  } | null>(null)
  const openTabMenu = (id: RightSidebarTabId, groupId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setTabMenu({ id, groupId, x: e.clientX, y: e.clientY })
  }
  const closeTabMenu = () => setTabMenu(null)

  // Inter-group resize state — same shape as SidebarStack.
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const setGroupRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) groupRefs.current[id] = el
    else delete groupRefs.current[id]
  }, [])
  const [draftHeights, setDraftHeights] = useState<Record<string, number>>({})
  const measureGroupHeight = useCallback((groupId: string): number => {
    const el = groupRefs.current[groupId]
    if (el) return el.getBoundingClientRect().height
    const persisted = groups.find(g => g.id === groupId)?.height
    return typeof persisted === 'number' ? persisted : 0
  }, [groups])

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto" data-testid="right-sidebar-stack">
      {groups.length === 0 && (
        <div className="p-4 text-sm text-obsidianSecondaryText" data-testid="right-sidebar-empty">
          No panels in the right sidebar. Click an icon on the right activity bar to add one.
        </div>
      )}
      {groups.map((g, idx) => {
        const hasExplicit = (g.height != null) || (g.id in draftHeights)
        const lastExpandedIdx = (() => {
          for (let i = groups.length - 1; i >= 0; i--) {
            if (!groups[i].collapsed && groups[i].height == null && !(groups[i].id in draftHeights)) {
              return i
            }
          }
          return -1
        })()
        const layoutMode: 'fill' | 'fixed' | 'auto' = hasExplicit
          ? 'fixed'
          : (idx === lastExpandedIdx ? 'fill' : 'auto')
        const draft = draftHeights[g.id]
        const next = groups[idx + 1]
        const showHandleBelow =
          next != null && !g.collapsed && !next.collapsed

        // Same fix as SidebarStack: the wrapper has to be a flex
        // column so SidebarGroup's `flex-1` (fill mode) actually
        // stretches to fill the remaining vertical space.
        const wrapperClass = layoutMode === 'fill'
          ? 'flex-1 min-h-0 flex flex-col'
          : 'shrink-0 flex flex-col'
        return (
          <div key={g.id} ref={setGroupRef(g.id)} className={wrapperClass}>
            <RightInterGroupDropZone
              active={dragActive}
              onDropId={(id) => {
                // Cross-sidebar: id may currently live in a left-side
                // group. Route through moveTabAcrossSidebars so the
                // left group loses the tab atomically.
                const left = useSettingsStore.getState().sidebarGroups
                if (left.some(g => g.tabs.includes(id))) {
                  moveTabAcrossSidebars(id, 'right', null, idx)
                } else {
                  createRightGroupWithTab(idx, id)
                }
              }}
            />
            <RightSidebarGroup
              group={g}
              layoutMode={layoutMode}
              draftHeight={draft}
              onTabContextMenu={(id, e) => openTabMenu(id, g.id, e)}
            />
            {showHandleBelow && (
              <GroupResizeHandle
                ariaLabel={`Resize group ${g.activeTab ?? g.id}`}
                aboveHeight={draft ?? measureGroupHeight(g.id)}
                belowHeight={draftHeights[next.id] ?? measureGroupHeight(next.id)}
                onResize={(nextAbove, nextBelow) => {
                  setDraftHeights(prev => ({
                    ...prev,
                    [g.id]: nextAbove,
                    [next.id]: nextBelow,
                  }))
                  setRightGroupHeight(g.id, nextAbove)
                  setRightGroupHeight(next.id, nextBelow)
                }}
                onReset={() => {
                  setDraftHeights(prev => {
                    const copy = { ...prev }
                    delete copy[g.id]
                    delete copy[next.id]
                    return copy
                  })
                  setRightGroupHeight(g.id, null)
                  setRightGroupHeight(next.id, null)
                }}
              />
            )}
          </div>
        )
      })}
      {groups.length > 0 && (
        <RightInterGroupDropZone
          active={dragActive}
          onDropId={(id) => {
            const left = useSettingsStore.getState().sidebarGroups
            if (left.some(g => g.tabs.includes(id))) {
              moveTabAcrossSidebars(id, 'right', null, groups.length)
            } else {
              createRightGroupWithTab(groups.length, id)
            }
          }}
        />
      )}
      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => { closeTabInRightGroup(tabMenu.groupId, tabMenu.id); closeTabMenu() }}
          onMoveToNewGroup={() => { moveTabToNewRightGroup(tabMenu.id); closeTabMenu() }}
          onMoveToOtherSidebar={() => {
            // Right → left: moveTabAcrossSidebars removes from the
            // right groups + creates a singleton left group in one
            // setState pass. lastFocusedGroupId is updated to the
            // new left group so the next activity-bar click lands
            // there.
            moveTabAcrossSidebars(tabMenu.id, 'left', null)
            closeTabMenu()
          }}
          moveToOtherSidebarLabel="Move to left sidebar"
          // Right side has no hidden-tabs list yet — hide is wired
          // to a no-op + close so the menu still works without
          // surprising the user with a hidden panel they can't find.
          onHide={closeTabMenu}
          onDismiss={closeTabMenu}
        />
      )}
    </div>
  )
}

export default RightSidebarStack
