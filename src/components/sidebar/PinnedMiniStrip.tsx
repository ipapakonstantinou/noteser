'use client'

import { useState } from 'react'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import { PANELS, TAB_DRAG_MIME } from './sidebarPanelRegistry'
import { type SidebarTabId } from '@/stores'

// Mini tab strip rendered ABOVE each pinned group's content. One
// icon per panel in the group; the active icon is highlighted.
// Click an icon to switch the group's active tab. The strip is
// a drag source (each icon draggable — drop elsewhere = move/unpin)
// AND a drop target (drop a tab from the main strip or another
// group here = add to this group). Right-click toggles pin/unpin.
export interface PinnedMiniStripProps {
  ids: SidebarTabId[]
  activeId: SidebarTabId
  onActivate: (id: SidebarTabId) => void
  onUnpin: (id: SidebarTabId) => void
  onAddToThisGroup: (id: SidebarTabId) => void
}

export const PinnedMiniStrip = ({
  ids, activeId, onActivate, onUnpin, onAddToThisGroup,
}: PinnedMiniStripProps) => {
  const [dropActive, setDropActive] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    const has = e.dataTransfer.types.includes(TAB_DRAG_MIME)
      || e.dataTransfer.types.includes(SIDEBAR_PANEL_DRAG_MIME)
    if (!has) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropActive(true)
  }
  const handleDragLeave = () => setDropActive(false)
  const handleDrop = (e: React.DragEvent) => {
    setDropActive(false)
    const tabDrag = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    const panelDrag = e.dataTransfer.getData(SIDEBAR_PANEL_DRAG_MIME) as SidebarTabId
    const droppedId = (tabDrag || panelDrag) as SidebarTabId
    if (!droppedId) return
    if (ids.includes(droppedId)) return
    e.preventDefault()
    onAddToThisGroup(droppedId)
  }

  return (
    <div
      className={`flex items-center gap-0.5 px-1 py-1 border-b border-obsidianBorder bg-obsidianDarkGray/40 ${
        dropActive ? 'outline outline-2 outline-obsidianAccentPurple/60' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {ids.map(id => {
        const def = PANELS.find(p => p.id === id)
        if (!def) return null
        const Icon = def.Icon
        const active = id === activeId
        return (
          <button
            key={id}
            type="button"
            draggable
            onDragStart={e => {
              e.dataTransfer.setData(SIDEBAR_PANEL_DRAG_MIME, id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => onActivate(id)}
            onContextMenu={e => { e.preventDefault(); onUnpin(id) }}
            title={`${def.title} — right-click to unpin`}
            aria-label={def.title}
            aria-pressed={active}
            data-testid={`sidebar-pinned-tab-${id}`}
            className={`flex items-center justify-center py-1.5 px-3 rounded cursor-grab active:cursor-grabbing transition-colors ${
              active
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText'
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        )
      })}
    </div>
  )
}
