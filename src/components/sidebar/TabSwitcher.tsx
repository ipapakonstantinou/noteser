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
//   1. A "drop here to pin to top" zone above the strip — inflated
//      while ANY sidebar drag is in flight so it's easy to hit.
//   2. The horizontal icon strip itself (drag to reorder + right-
//      click to pin).
//   3. The active tab's panel body, full-height.
//
// Owns all the drag state for the strip; the host (SidebarStack)
// passes a `dragActive` flag derived from a window-level dragstart
// listener so this strip's pin-zone lights up even when the drag
// began from a different child (e.g. a pinned mini-strip above).
export interface TabSwitcherProps {
  pinnedIds: SidebarTabId[]
  tabOrderSaved: string[]
  onRightClick: PanelRightClick
  onPinPanel: (id: SidebarTabId) => void
  onUnpinPanel: (id: SidebarTabId) => void
  // True when ANY sidebar drag is in flight — inflates the pin-zone
  // so the user can land a drop without pixel-precise hovering.
  dragActive: boolean
}

export const TabSwitcher = ({
  pinnedIds, tabOrderSaved, onRightClick, onPinPanel, onUnpinPanel, dragActive,
}: TabSwitcherProps) => {
  const tabId = useUIStore(s => s.sidebarTabId)
  const setTab = useUIStore(s => s.setSidebarTab)
  const setSidebarTabOrder = useSettingsStore(s => s.setSidebarTabOrder)

  const orderedIds = useMemo(
    () => resolveTabOrder(tabOrderSaved, pinnedIds),
    [tabOrderSaved, pinnedIds],
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

  // Pin-zone drop indicator. When a tab is being dragged near the top
  // edge of the strip we light up a horizontal bar that doubles as the
  // pin-target — drop here = move to pinned-top.
  const [pinDropActive, setPinDropActive] = useState(false)

  const handleDragStart = (id: SidebarTabId) => (e: React.DragEvent) => {
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
    setDraggingId(null); setDropTargetId(null); setPinDropActive(false)
  }

  // Pin drop-zone (above the strip). Listens for tab-MIME payloads;
  // on drop, pins the dragged tab.
  const onPinDropOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setPinDropActive(true)
  }
  const onPinDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    setPinDropActive(false)
    if (!id) return
    e.preventDefault()
    onPinPanel(id)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-obsidianBorder">
      {/* Pin drop zone — visible whenever ANY sidebar drag is in
          flight, not just a drag started from this strip. The
          inflated 24px height makes the target easy to land on
          (the user complained that 6px was too thin). */}
      <div
        onDragOver={onPinDropOver}
        onDragLeave={() => setPinDropActive(false)}
        onDrop={onPinDrop}
        className={`${(draggingId || dragActive) ? 'h-6' : 'h-0'} transition-all flex-shrink-0 flex items-center justify-center text-[10px] uppercase tracking-wide ${
          pinDropActive
            ? 'bg-obsidianAccentPurple text-white'
            : (draggingId || dragActive)
              ? 'bg-obsidianAccentPurple/15 text-obsidianAccentPurple'
              : 'bg-transparent text-transparent'
        }`}
        aria-label="Drop here to pin tab at top"
        data-testid="sidebar-pin-dropzone"
      >
        {(draggingId || dragActive) && (pinDropActive ? 'Drop to pin' : '↑ pin to top')}
      </div>

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
                onContextMenu={e => {
                  // Right-click pins the tab to the top zone (creating
                  // a new pinned mini-strip group). Pairs with the
                  // drag-up gesture.
                  e.preventDefault()
                  onPinPanel(id)
                }}
                title={`${def.title} — right-click to pin to top`}
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
