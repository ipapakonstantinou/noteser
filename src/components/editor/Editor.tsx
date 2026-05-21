'use client'

import { useRef, useState } from 'react'
import { useWorkspaceStore } from '@/stores'
import { useViewport } from '@/hooks'
import { Pane } from './Pane'

// Renders the workspace's panes side by side. For v1 we cap at 2 panes
// (horizontal split). The divider between them is draggable to resize.

const DEFAULT_LEFT_RATIO = 0.5

export const Editor = () => {
  const panes = useWorkspaceStore(s => s.panes)
  const activePaneId = useWorkspaceStore(s => s.activePaneId)
  const [leftRatio, setLeftRatio] = useState(DEFAULT_LEFT_RATIO)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startRatio: number } | null>(null)
  const { isMobile } = useViewport()

  // Mobile: there isn't room for a horizontal split, so render only the
  // active pane. The second pane's tabs stay in the store — when the
  // viewport grows back past the breakpoint, the split reappears intact.
  if (isMobile && panes.length > 1) {
    const active = panes.find(p => p.id === activePaneId) ?? panes[0]
    return (
      <div className="flex h-full w-full overflow-hidden">
        <Pane pane={active} allowSplitDropZone={false} />
      </div>
    )
  }

  // Single pane: no divider, full width.
  if (panes.length <= 1) {
    return (
      <div className="flex h-full w-full overflow-hidden">
        <Pane pane={panes[0]} allowSplitDropZone={!isMobile} />
      </div>
    )
  }

  // Two panes: horizontal split with draggable divider.
  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startRatio: leftRatio }
    const handleMove = (ev: MouseEvent) => {
      if (!containerRef.current || !dragRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const delta = (ev.clientX - dragRef.current.startX) / rect.width
      const next = dragRef.current.startRatio + delta
      // Clamp so neither pane vanishes.
      setLeftRatio(Math.min(0.85, Math.max(0.15, next)))
    }
    const handleUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <div style={{ width: `${leftRatio * 100}%` }} className="flex min-w-0 flex-shrink-0">
        <Pane pane={panes[0]} allowSplitDropZone={false} />
      </div>
      <div
        onMouseDown={onDividerMouseDown}
        className="w-1 cursor-col-resize bg-obsidianBorder hover:bg-obsidianAccentPurple/60 flex-shrink-0 transition-colors"
        title="Drag to resize"
      />
      <div style={{ width: `${(1 - leftRatio) * 100}%` }} className="flex min-w-0 flex-shrink-0">
        <Pane pane={panes[1]} allowSplitDropZone={false} />
      </div>
    </div>
  )
}

export default Editor
