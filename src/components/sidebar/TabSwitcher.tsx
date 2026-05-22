'use client'

import { useMemo, useRef, useState } from 'react'
import { useUIStore, useSettingsStore, type SidebarTabId } from '@/stores'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import {
  PANELS,
  TAB_DRAG_MIME,
  PanelBody,
  resolveTabOrder,
  type PanelRightClick,
} from './sidebarPanelRegistry'

// Lower-half tab switcher in the sidebar (Obsidian model). Renders:
//   1. The horizontal icon strip itself (drag to reorder + right-click
//      opens the TabContextMenu for Pin/Hide).
//   2. The active tab's panel body, full-height.
//
// The strip owns the drag state for its own icons (reorder + cross-
// pane move). Pinning is routed through the parent SidebarStack's
// TabContextMenu — right-click no longer pins instantly.
export interface TabSwitcherProps {
  pinnedIds: SidebarTabId[]
  tabOrderSaved: string[]
  // Tab ids the user has hidden via the context menu. We filter them
  // out of the visible strip but leave them in the saved order so a
  // future unhide brings them back where they were.
  hiddenIds: ReadonlySet<string>
  onRightClick: PanelRightClick
  onTabContextMenu: (id: SidebarTabId, e: React.MouseEvent) => void
  // Drag-down-from-pinned-strip unpins via this callback. Separate
  // from the right-click context menu (which routes through
  // onTabContextMenu) because drag is its own gesture.
  onUnpinPanel: (id: SidebarTabId) => void
}

export const TabSwitcher = ({
  pinnedIds, tabOrderSaved, hiddenIds, onRightClick, onTabContextMenu, onUnpinPanel,
}: TabSwitcherProps) => {
  const tabId = useUIStore(s => s.sidebarTabId)
  const setTab = useUIStore(s => s.setSidebarTab)
  const setSidebarTabOrder = useSettingsStore(s => s.setSidebarTabOrder)

  const orderedIds = useMemo(
    () => resolveTabOrder(tabOrderSaved, pinnedIds).filter(id => !hiddenIds.has(id)),
    [tabOrderSaved, pinnedIds, hiddenIds],
  )
  // The store may hold a tabId that's currently pinned (e.g. user just
  // pinned the active tab). In that case fall back to the first id in
  // the strip so the panel content area isn't blank.
  const effectiveTabId: SidebarTabId | null = pinnedIds.includes(tabId)
    ? (orderedIds[0] ?? null)
    : tabId

  const panelsById = useMemo(() => new Map(PANELS.map(p => [p.id, p])), [])

  const [draggingId, setDraggingId] = useState<SidebarTabId | null>(null)
  const [dropTargetId, setDropTargetId] = useState<SidebarTabId | null>(null)
  const dropPos = useRef<'before' | 'after'>('before')

  const handleDragStart = (id: SidebarTabId) => (e: React.DragEvent) => {
    // Guard against right-click-initiated drag. Firefox + Chromium-Linux
    // fire dragstart on draggable elements for non-primary mouse buttons,
    // which lets a right-click bleed into a phantom "drop on top" — the
    // SidebarStack window listener then inflates drop zones, looking like
    // the row jumped on its own. Spec says browsers SHOULD ignore non-
    // primary buttons here; not all do.
    if (e.nativeEvent && e.nativeEvent.button !== 0) return
    e.dataTransfer.setData(TAB_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(id)
  }

  const handleDragOver = (id: SidebarTabId) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME) && !e.dataTransfer.types.includes(SIDEBAR_PANEL_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropPos.current = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after'
    setDropTargetId(id)
  }

  const handleDragLeave = () => {
    setDropTargetId(null)
  }

  const handleDrop = (targetId: SidebarTabId) => (e: React.DragEvent) => {
    // Two kinds of payload: a tab-strip drag (reorder within strip)
    // or a pinned-section drag (move from pinned-top to strip).
    const droppedFromTab = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    const droppedFromPin = e.dataTransfer.getData(SIDEBAR_PANEL_DRAG_MIME) as SidebarTabId
    const droppedId = (droppedFromTab || droppedFromPin) as SidebarTabId | ''
    if (!droppedId) {
      setDraggingId(null); setDropTargetId(null); return
    }
    e.preventDefault()

    // Coming FROM pinned → unpin first, then place in tab order.
    if (droppedFromPin) {
      onUnpinPanel(droppedId)
    }
    if (droppedId === targetId) {
      setDraggingId(null); setDropTargetId(null); return
    }

    // Compute the new tab order. We use the freshly-computed strip
    // (orderedIds) as the base — for the pin→tab case we add the
    // unpinned id; for the in-strip case we already have it.
    const base = droppedFromPin
      ? [...orderedIds, droppedId]
      : orderedIds
    const next = base.filter(id => id !== droppedId)
    const idx = next.indexOf(targetId)
    if (idx === -1) {
      next.push(droppedId)
    } else {
      next.splice(dropPos.current === 'before' ? idx : idx + 1, 0, droppedId)
    }
    setSidebarTabOrder(next)
    setDraggingId(null); setDropTargetId(null)
  }

  const handleDragEnd = () => {
    setDraggingId(null); setDropTargetId(null)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-obsidianBorder">
      {/* The visible "↑ PIN TO TOP" drop zone was removed per user
          feedback (2026-05-21) — it added vertical noise during
          drags and could get visually stuck after an external
          dragend. Pinning a tab from the bottom strip is now done
          via right-click on the icon (already wired below). */}
      <div className="flex items-center gap-0.5 px-1 py-1 border-b border-obsidianBorder bg-obsidianDarkGray/40">
        {orderedIds.map(id => {
          const def = panelsById.get(id)
          if (!def) return null
          const active = effectiveTabId === id
          const dragging = draggingId === id
          const isDropTarget = dropTargetId === id
          const Icon = def.Icon
          return (
            <div
              key={id}
              draggable
              onDragStart={handleDragStart(id)}
              onDragOver={handleDragOver(id)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(id)}
              onDragEnd={handleDragEnd}
              className={[
                'flex-1 relative',
                dragging ? 'opacity-40' : '',
                isDropTarget && dropPos.current === 'before' ? 'border-l-2 border-obsidianAccentPurple -ml-[2px]' : '',
                isDropTarget && dropPos.current === 'after'  ? 'border-r-2 border-obsidianAccentPurple -mr-[2px]' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => setTab(id)}
                onContextMenu={e => onTabContextMenu(id, e)}
                title={`${def.title} — right-click for options`}
                aria-label={def.title}
                aria-pressed={active}
                data-testid={`sidebar-tab-${id}`}
                className={`w-full flex items-center justify-center py-1.5 rounded transition-colors ${
                  active
                    ? 'bg-obsidianHighlight text-obsidianText'
                    : 'text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText'
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {effectiveTabId && <PanelBody id={effectiveTabId} onRightClick={onRightClick} />}
      </div>
    </div>
  )
}
