'use client'

import { useState } from 'react'
import { RIGHT_TAB_DRAG_MIME, type RightSidebarTabId } from './rightPanelRegistry'

// Right-side inter-group drop zone — copy of InterGroupDropZone but
// listens for RIGHT_TAB_DRAG_MIME only. Filtering on the right MIME
// (instead of also accepting the left's TAB_DRAG_MIME / panel MIME)
// is what keeps left-side panel drags from accidentally spawning
// new groups on the right side.
export interface RightInterGroupDropZoneProps {
  active: boolean
  onDropId: (id: RightSidebarTabId) => void
}

export const RightInterGroupDropZone = ({ active, onDropId }: RightInterGroupDropZoneProps) => {
  const [hot, setHot] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(RIGHT_TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setHot(true)
  }
  const handleDragLeave = () => setHot(false)
  const handleDrop = (e: React.DragEvent) => {
    setHot(false)
    const id = e.dataTransfer.getData(RIGHT_TAB_DRAG_MIME) as RightSidebarTabId
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
      data-testid="right-sidebar-inter-group-dropzone"
    >
      {active && (hot ? 'Drop here for a new pane' : 'new pane here')}
    </div>
  )
}
