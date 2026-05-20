'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore, type SidebarTabId } from '@/stores'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import { InterGroupDropZone } from './InterGroupDropZone'
import { PinnedGroup } from './PinnedGroup'
import { TabSwitcher } from './TabSwitcher'
import {
  KNOWN_IDS,
  TAB_DRAG_MIME,
  resolveTabOrder,
  type PanelRightClick,
} from './sidebarPanelRegistry'

// Re-export resolveTabOrder so older callers (the unit test, future
// consumers) keep their existing `from './SidebarStack'` import path.
export { resolveTabOrder }

interface Props {
  onRightClick: PanelRightClick
}

export const SidebarStack = ({ onRightClick }: Props) => {
  const pinnedSaved = useSettingsStore(s => s.pinnedPanels)
  const setPinnedPanels = useSettingsStore(s => s.setPinnedPanels)
  const tabOrderSaved = useSettingsStore(s => s.sidebarTabOrder)

  // Sanitise pinnedPanels: outer array = groups, each inner array =
  // tabs in that group. Drop unknown ids, drop empty groups, de-dupe
  // across groups (a panel can only live in one place). Returns
  // SidebarTabId[][].
  const pinnedGroups = useMemo<SidebarTabId[][]>(() => {
    const seen = new Set<string>()
    const out: SidebarTabId[][] = []
    for (const group of pinnedSaved) {
      if (!Array.isArray(group)) continue
      const cleaned: SidebarTabId[] = []
      for (const id of group) {
        if (KNOWN_IDS.has(id as SidebarTabId) && !seen.has(id)) {
          seen.add(id)
          cleaned.push(id as SidebarTabId)
        }
      }
      if (cleaned.length > 0) out.push(cleaned)
    }
    return out
  }, [pinnedSaved])

  // Flat list of every pinned id — handy for resolveTabOrder + lookup.
  const pinnedFlat = useMemo<SidebarTabId[]>(
    () => pinnedGroups.flat(),
    [pinnedGroups],
  )

  // ── Pin/unpin / group ops ────────────────────────────────────────────
  // pinAsNewGroup creates a NEW group at the bottom of the pinned
  // stack containing just `id`. Used by right-click-on-main-strip and
  // drag-to-pin-drop-zone.
  const pinAsNewGroup = (id: SidebarTabId) => {
    if (pinnedFlat.includes(id)) return
    setPinnedPanels([...pinnedGroups, [id]])
  }
  // pinIntoGroup adds `id` to an existing group at `groupIndex`. Used
  // when the user drops a tab onto an existing pinned mini-strip.
  // If `id` is already pinned elsewhere, it's moved (removed from
  // its previous group first).
  const pinIntoGroup = (id: SidebarTabId, groupIndex: number) => {
    const next: SidebarTabId[][] = pinnedGroups
      .map(g => g.filter(p => p !== id))
      .filter(g => g.length > 0)
    // groupIndex may have shifted if we just removed an empty group
    // before it. Re-find the target by panel set (use any remaining
    // id from the original target group as an anchor).
    const targetAnchor = pinnedGroups[groupIndex]?.find(p => p !== id) ?? null
    const realIndex = targetAnchor == null
      ? Math.min(groupIndex, next.length - 1)
      : next.findIndex(g => g.includes(targetAnchor))
    if (realIndex < 0 || realIndex >= next.length) {
      // Target group disappeared (it only contained the dragged id);
      // re-pin as a new solo group at the original spot.
      const insertAt = Math.min(groupIndex, next.length)
      next.splice(insertAt, 0, [id])
    } else {
      next[realIndex] = [...next[realIndex], id]
    }
    setPinnedPanels(next)
  }
  // unpinPanel removes `id` from whatever group it lives in. Empty
  // groups are dropped so we don't leave phantom strips.
  const unpinPanel = (id: SidebarTabId) => {
    if (!pinnedFlat.includes(id)) return
    const next = pinnedGroups
      .map(g => g.filter(p => p !== id))
      .filter(g => g.length > 0)
    setPinnedPanels(next)
  }
  // pinAsNewGroupAt creates a NEW solo group at a specific position
  // in the stack. Used by the inter-group drop zones so the user
  // can insert a new pane between two existing ones precisely.
  const pinAsNewGroupAt = (id: SidebarTabId, insertAt: number) => {
    const next = pinnedGroups
      .map(g => g.filter(p => p !== id))
      .filter(g => g.length > 0)
    next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, [id])
    setPinnedPanels(next)
  }

  // Track whether a sidebar drag is in flight. Used to inflate the
  // drop zones (main pin-zone + inter-group zones) so the user can
  // hit them more easily. Window-level dragstart / dragend listener
  // so we react regardless of which child started the drag.
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
    return () => {
      window.removeEventListener('dragstart', onStart)
      window.removeEventListener('dragend', onEnd)
      window.removeEventListener('drop', onEnd)
    }
  }, [])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Scrollable pinned area — lets the user stack arbitrarily
          many groups without crowding out the main tab strip below.
          max-h-[60%] caps it so the bottom switcher stays reachable;
          internal scroll handles the rest. */}
      {pinnedGroups.length > 0 && (
        <div className="flex-shrink min-h-0 overflow-y-auto" style={{ maxHeight: '60%' }}>
          {pinnedGroups.map((group, groupIndex) => (
            <div key={group.join(',')}>
              {/* Inter-group drop zone ABOVE this group. During drag
                  it's tall + visibly highlighted; otherwise zero-height. */}
              <InterGroupDropZone
                active={dragActive}
                onDropId={(id) => pinAsNewGroupAt(id, groupIndex)}
              />
              <PinnedGroup
                group={group}
                onUnpin={unpinPanel}
                onAddToThisGroup={(otherId) => pinIntoGroup(otherId, groupIndex)}
                onRightClick={onRightClick}
              />
            </div>
          ))}
          {/* Trailing zone — insert a new group at the end. */}
          <InterGroupDropZone
            active={dragActive}
            onDropId={(id) => pinAsNewGroupAt(id, pinnedGroups.length)}
          />
        </div>
      )}
      <TabSwitcher
        pinnedIds={pinnedFlat}
        tabOrderSaved={tabOrderSaved}
        onRightClick={onRightClick}
        onPinPanel={pinAsNewGroup}
        onUnpinPanel={unpinPanel}
        dragActive={dragActive}
      />
    </div>
  )
}

export default SidebarStack
