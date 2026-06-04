'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSettingsStore, type SidebarTabId, type SidebarGroupState } from '@/stores'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import { InterGroupDropZone } from './InterGroupDropZone'
import { SidebarGroup } from './SidebarGroup'
import { GroupResizeHandle } from './GroupResizeHandle'
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
// inter-group drop zones for drag-to-new-group + the inter-group
// resize handles.
export const SidebarStack = ({ onRightClick }: Props) => {
  const sidebarGroupsSaved = useSettingsStore(s => s.sidebarGroups)
  const hiddenSidebarTabs = useSettingsStore(s => s.hiddenSidebarTabs)
  const hideSidebarTab = useSettingsStore(s => s.hideSidebarTab)
  const setGroupHeight = useSettingsStore(s => s.setGroupHeight)

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
        height: g.height ?? null,
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

  // ── Inter-group resize state ─────────────────────────────────────────
  // Refs onto each group's outer wrapper so we can read the actual
  // pixel height before a drag starts (works whether the group is
  // currently using flex-1 or an explicit height — both flow through
  // the DOM). Stored as a record keyed by group id so reorders /
  // group-id changes don't leak stale refs.
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const setGroupRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) groupRefs.current[id] = el
    else delete groupRefs.current[id]
  }, [])

  // Draft heights — live snapshot of what the user is dragging towards.
  // We update these on every mousemove so the layout tracks the pointer
  // 1:1; on mouseup we commit to settingsStore.setGroupHeight (cheaper
  // than hammering persist + re-running every store subscriber each
  // frame). Keyed by group id.
  const [draftHeights, setDraftHeights] = useState<Record<string, number>>({})

  // Helper: read the current rendered height of a group. Falls back to
  // the persisted `height` field, then to 0 if the ref isn't mounted
  // yet (defensive — the handle never mounts before its neighbours).
  const measureGroupHeight = useCallback((groupId: string): number => {
    const el = groupRefs.current[groupId]
    if (el) return el.getBoundingClientRect().height
    const persisted = groups.find(g => g.id === groupId)?.height
    return typeof persisted === 'number' ? persisted : 0
  }, [groups])

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
      {groups.map((g, idx) => {
        // Layout assignment:
        //   - A group with an explicit `height` (or in-flight draft) is
        //     'fixed' so the user's drag value wins.
        //   - The LAST expanded group with no explicit height is
        //     'fill' so leftover vertical space lands there cleanly.
        //   - Everything else is 'auto' (size to content / flex-shrink).
        // Collapsed groups always size to content; the SidebarGroup
        // component ignores the layoutMode in that branch.
        const hasExplicit = (g.height != null) || (g.id in draftHeights)
        // Find the index of the LAST expanded group (the trailing fill
        // target). We treat both explicit and auto groups as candidates
        // but prefer auto + last so explicit-height users see their
        // values respected.
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

        // The resize handle between THIS group and the next one only
        // mounts when both are expanded — collapsed groups have no
        // body to grow into, so resizing them would just shuffle the
        // chrome. Also skip the handle after the last group.
        const next = groups[idx + 1]
        const showHandleBelow =
          next != null && !g.collapsed && !next.collapsed

        return (
          <div key={g.id} ref={setGroupRef(g.id)}>
            <InterGroupDropZone
              active={dragActive}
              onDropId={(id) => createGroupWithTab(idx, id)}
            />
            <SidebarGroup
              group={g}
              layoutMode={layoutMode}
              draftHeight={draft}
              onTabContextMenu={(id, e) => openTabMenu(id, g.id, e)}
              onRightClick={onRightClick}
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
                  // Commit to the store too — the store's same-ref
                  // short-circuit drops no-op writes, so this is
                  // cheap. Doing it inline (instead of on mouseup)
                  // means a refresh mid-drag won't lose state.
                  setGroupHeight(g.id, nextAbove)
                  setGroupHeight(next.id, nextBelow)
                }}
                onReset={() => {
                  setDraftHeights(prev => {
                    const copy = { ...prev }
                    delete copy[g.id]
                    delete copy[next.id]
                    return copy
                  })
                  setGroupHeight(g.id, null)
                  setGroupHeight(next.id, null)
                }}
              />
            )}
          </div>
        )
      })}
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
