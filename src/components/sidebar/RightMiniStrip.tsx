'use client'

import { useRef, useState } from 'react'
import {
  RIGHT_PANELS,
  RIGHT_TAB_DRAG_MIME,
  type RightSidebarTabId,
} from './rightPanelRegistry'

// Mini tab strip for the RIGHT sidebar — copy of PinnedMiniStrip but
// pinned (no pun intended) to the right-side registry + drag MIME.
// Kept as a separate component so the left + right strips don't share
// runtime config (different icon sets, different drag MIMEs) and so
// adding a left-only feature like the strip's leadingSlot collapse
// chevron doesn't accidentally drag right-side behaviour along with
// it.
//
// Interactions match the left-side strip:
//   - Click → switch the group's active tab.
//   - Drag intra-strip → reorder.
//   - Drop from another right-side strip → add to this group.
//   - Right-click → open the per-tab context menu.

export interface RightMiniStripProps {
  ids: RightSidebarTabId[]
  activeId: RightSidebarTabId
  onActivate: (id: RightSidebarTabId) => void
  onAddToThisGroup: (id: RightSidebarTabId) => void
  onReorder?: (newIds: RightSidebarTabId[]) => void
  onTabContextMenu?: (id: RightSidebarTabId, e: React.MouseEvent) => void
  leadingSlot?: React.ReactNode
}

type DropPos = { idx: number; side: 'before' | 'after' } | null

export const RightMiniStrip = ({
  ids, activeId, onActivate, onAddToThisGroup, onReorder, onTabContextMenu, leadingSlot,
}: RightMiniStripProps) => {
  const [dropActive, setDropActive] = useState(false)
  const [dropPos, setDropPos] = useState<DropPos>(null)
  const dropPosRef = useRef<DropPos>(null)

  const setDrop = (next: DropPos) => {
    dropPosRef.current = next
    setDropPos(next)
  }

  const onIconDragOver = (idx: number) => (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (!types.includes(RIGHT_TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side: 'before' | 'after' = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    setDrop({ idx, side })
    setDropActive(true)
  }

  const onStripDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (!types.includes(RIGHT_TAB_DRAG_MIME)) return
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
    const droppedId = e.dataTransfer.getData(RIGHT_TAB_DRAG_MIME) as RightSidebarTabId
    const pos = dropPosRef.current
    setDrop(null)
    if (!droppedId) return
    e.preventDefault()

    if (onReorder && ids.includes(droppedId) && pos) {
      const without = ids.filter(id => id !== droppedId)
      const targetIcon = ids[pos.idx]
      const targetIdxInWithout = without.indexOf(targetIcon)
      if (targetIdxInWithout < 0) return
      const insertAt = pos.side === 'before' ? targetIdxInWithout : targetIdxInWithout + 1
      const next = [...without]
      next.splice(insertAt, 0, droppedId)
      if (next.every((id, i) => id === ids[i])) return
      onReorder(next)
      return
    }

    if (!ids.includes(droppedId)) {
      onAddToThisGroup(droppedId)
    }
  }

  return (
    <div
      className={`relative flex items-center gap-0.5 px-1 py-1 border-b border-obsidianBorder ${
        dropActive ? 'outline outline-2 outline-obsidianAccentPurple/60' : ''
      }`}
      onDragOver={onStripDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-testid="right-sidebar-pinned-strip"
    >
      {leadingSlot}
      {ids.map((id, idx) => {
        const def = RIGHT_PANELS.find(p => p.id === id)
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
              if (e.nativeEvent && e.nativeEvent.button !== 0) return
              e.dataTransfer.setData(RIGHT_TAB_DRAG_MIME, id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={onIconDragOver(idx)}
            onClick={() => onActivate(id)}
            onContextMenu={e => {
              if (onTabContextMenu) {
                onTabContextMenu(id, e)
              }
            }}
            title={`${def.title} — drag to reorder, right-click for options`}
            aria-label={def.title}
            aria-pressed={active}
            data-testid={`right-sidebar-pinned-tab-${id}`}
            className={[
              'relative flex items-center justify-center py-1.5 max-md:py-2.5 px-3 rounded cursor-grab active:cursor-grabbing transition-colors',
              showInsertBefore ? 'border-l-2 border-obsidianAccentPurple -ml-[2px]' : '',
              showInsertAfter ? 'border-r-2 border-obsidianAccentPurple -mr-[2px]' : '',
              active
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText',
            ].join(' ')}
          >
            <Icon className="w-4 h-4 max-md:w-5 max-md:h-5" />
          </button>
        )
      })}
    </div>
  )
}
