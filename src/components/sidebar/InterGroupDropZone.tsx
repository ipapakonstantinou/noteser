'use client'

import { useState } from 'react'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import { TAB_DRAG_MIME, type PanelRightClick } from './sidebarPanelRegistry'
import { type SidebarTabId } from '@/stores'

// (`onRightClick` type is re-exported as PanelRightClick for ergonomic
// imports; not used by THIS component, but lifted here so neighbouring
// extracted components share an import surface.)
void ((null as unknown) as PanelRightClick)

// Thin drop zone rendered ABOVE each sidebar group (and once at the
// end of the stack) so the user can position a new group between two
// existing ones. Zero-height when nothing is being dragged; inflates
// to 24px during a drag for an easy target.
export interface InterGroupDropZoneProps {
  active: boolean
  onDropId: (id: SidebarTabId) => void
}

export const InterGroupDropZone = ({ active, onDropId }: InterGroupDropZoneProps) => {
  const [hot, setHot] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types
    if (!t.includes(TAB_DRAG_MIME) && !t.includes(SIDEBAR_PANEL_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setHot(true)
  }
  const handleDragLeave = () => setHot(false)
  const handleDrop = (e: React.DragEvent) => {
    setHot(false)
    const tabDrag = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    const panelDrag = e.dataTransfer.getData(SIDEBAR_PANEL_DRAG_MIME) as SidebarTabId
    const id = (tabDrag || panelDrag) as SidebarTabId
    if (!id) return
    e.preventDefault()
    onDropId(id)
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`${active ? 'h-6' : 'h-0'} transition-all shrink-0 flex items-center justify-center text-[10px] uppercase tracking-wide ${
        hot
          ? 'bg-obsidianAccentPurple text-white'
          : active
            ? 'bg-obsidianAccentPurple/10 text-obsidianAccentPurple/70 border-y border-dashed border-obsidianAccentPurple/30'
            : 'bg-transparent text-transparent'
      }`}
      data-testid="sidebar-inter-group-dropzone"
    >
      {active && (hot ? 'Drop here for a new pane' : '↓ new pane here')}
    </div>
  )
}
