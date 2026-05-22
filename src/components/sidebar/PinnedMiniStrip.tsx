'use client'

import { useRef, useState } from 'react'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import { PANELS, TAB_DRAG_MIME } from './sidebarPanelRegistry'
import { type SidebarTabId } from '@/stores'

// Mini tab strip rendered ABOVE each pinned group's content. One
// icon per panel in the group; the active icon is highlighted.
//
// Drag interactions:
//   - Click an icon to switch the group's active tab.
//   - Right-click to unpin (sends the panel back to the bottom strip).
//   - Drag an icon WITHIN the strip to reorder (intra-strip).
//   - Drag an icon OUT of the strip to move it elsewhere
//     (handled by other drop targets — main TabSwitcher, other groups).
//   - Drop a tab from another strip ONTO this strip to add it to
//     this group (cross-group move).
export interface PinnedMiniStripProps {
  ids: SidebarTabId[]
  activeId: SidebarTabId
  onActivate: (id: SidebarTabId) => void
  onUnpin: (id: SidebarTabId) => void
  // Cross-group: add a tab from another strip into this group.
  onAddToThisGroup: (id: SidebarTabId) => void
  // Intra-strip: replace this group's id list with a new order.
  // Called when the user drags an icon left/right within the strip.
  onReorder?: (newIds: SidebarTabId[]) => void
}

// Where in the strip a drop would land: before or after the icon at
// `idx`. Used to render the insertion line.
type DropPos = { idx: number; side: 'before' | 'after' } | null

export const PinnedMiniStrip = ({
  ids, activeId, onActivate, onUnpin, onAddToThisGroup, onReorder,
}: PinnedMiniStripProps) => {
  const [dropActive, setDropActive] = useState(false)
  const [dropPos, setDropPos] = useState<DropPos>(null)
  // Use a ref alongside the state so the drop handler can read the
  // latest position without depending on stale state-closure values.
  const dropPosRef = useRef<DropPos>(null)

  const setDrop = (next: DropPos) => {
    dropPosRef.current = next
    setDropPos(next)
  }

  // Compute insertion position from the icon's bounding rect — left
  // half = before, right half = after.
  const onIconDragOver = (idx: number) => (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    const has = types.includes(TAB_DRAG_MIME) || types.includes(SIDEBAR_PANEL_DRAG_MIME)
    if (!has) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side: 'before' | 'after' = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    setDrop({ idx, side })
    setDropActive(true)
  }

  const onStripDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    const has = types.includes(TAB_DRAG_MIME) || types.includes(SIDEBAR_PANEL_DRAG_MIME)
    if (!has) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropActive(true)
  }

  const onDragLeave = () => {
    setDropActive(false)
    setDrop(null)
  }

  const onDrop = (e: React.DragEvent) => {
    setDropActive(false)
    const tabDrag = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    const panelDrag = e.dataTransfer.getData(SIDEBAR_PANEL_DRAG_MIME) as SidebarTabId
    const droppedId = (tabDrag || panelDrag) as SidebarTabId
    const pos = dropPosRef.current
    setDrop(null)
    if (!droppedId) return
    e.preventDefault()

    // Intra-strip reorder: drag came from inside this group AND we
    // have a target position. Recompute the ids array with the
    // dragged item moved to the new slot.
    if (onReorder && ids.includes(droppedId) && pos) {
      const without = ids.filter(id => id !== droppedId)
      const targetIcon = ids[pos.idx]
      const targetIdxInWithout = without.indexOf(targetIcon)
      // `targetIcon` may BE the dragged one (drop on self). In that
      // case targetIdxInWithout is -1 — bail; the user didn't move
      // anything meaningful.
      if (targetIdxInWithout < 0) return
      const insertAt = pos.side === 'before' ? targetIdxInWithout : targetIdxInWithout + 1
      const next = [...without]
      next.splice(insertAt, 0, droppedId)
      // No-op if order didn't actually change.
      if (next.every((id, i) => id === ids[i])) return
      onReorder(next)
      return
    }

    // Cross-strip: bring a new tab into this group.
    if (!ids.includes(droppedId)) {
      onAddToThisGroup(droppedId)
    }
  }

  return (
    <div
      className={`relative flex items-center gap-0.5 px-1 py-1 border-b border-obsidianBorder bg-obsidianDarkGray/40 ${
        dropActive ? 'outline outline-2 outline-obsidianAccentPurple/60' : ''
      }`}
      onDragOver={onStripDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-testid="sidebar-pinned-strip"
    >
      {ids.map((id, idx) => {
        const def = PANELS.find(p => p.id === id)
        if (!def) return null
        const Icon = def.Icon
        const active = id === activeId
        const showInsertBefore = dropPos?.idx === idx && dropPos.side === 'before'
        const showInsertAfter = dropPos?.idx === idx && dropPos.side === 'after'
        return (
          <button
            key={id}
            type="button"
            draggable
            onDragStart={e => {
              // Right-click on a draggable button fires dragstart on
              // Firefox + Chromium-Linux before the contextmenu — gating
              // on the primary button stops the unpin click from
              // bleeding into a phantom drag.
              if (e.nativeEvent && e.nativeEvent.button !== 0) return
              e.dataTransfer.setData(SIDEBAR_PANEL_DRAG_MIME, id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={onIconDragOver(idx)}
            onClick={() => onActivate(id)}
            onContextMenu={e => { e.preventDefault(); onUnpin(id) }}
            title={`${def.title} — drag to reorder, right-click to unpin`}
            aria-label={def.title}
            aria-pressed={active}
            data-testid={`sidebar-pinned-tab-${id}`}
            className={[
              'relative flex items-center justify-center py-1.5 px-3 rounded cursor-grab active:cursor-grabbing transition-colors',
              showInsertBefore ? 'border-l-2 border-obsidianAccentPurple -ml-[2px]' : '',
              showInsertAfter ? 'border-r-2 border-obsidianAccentPurple -mr-[2px]' : '',
              active
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText',
            ].join(' ')}
          >
            <Icon className="w-4 h-4" />
          </button>
        )
      })}
    </div>
  )
}
