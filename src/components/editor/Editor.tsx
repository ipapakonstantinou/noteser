'use client'

import { useRef, useCallback } from 'react'
import { useWorkspaceStore } from '@/stores'
import { useViewport } from '@/hooks'
import { Pane } from './Pane'
import type { LayoutNode, PaneState } from '@/stores/workspaceStore'

// Renders the workspace's panes laid out according to the layout tree.
// Up to MAX_PANES (3) panes total; arrangements include horizontal,
// vertical, and L-shapes (a horizontal split whose right or left child
// is itself a vertical split).

const MIN_PANE_RATIO = 0.05

export const Editor = () => {
  const panes = useWorkspaceStore(s => s.panes)
  const layout = useWorkspaceStore(s => s.layout)
  const activePaneId = useWorkspaceStore(s => s.activePaneId)
  const { isMobile } = useViewport()

  const paneById = (id: string): PaneState | undefined => panes.find(p => p.id === id)

  // Mobile: there isn't room for a split, so render only the active pane.
  // The other panes' tabs stay in the store — when the viewport grows back
  // past the breakpoint, the layout reappears intact.
  if (isMobile && panes.length > 1) {
    const active = panes.find(p => p.id === activePaneId) ?? panes[0]
    return (
      <div className="flex h-full w-full overflow-hidden">
        <Pane pane={active} />
      </div>
    )
  }

  if (panes.length <= 1) {
    return (
      <div className="flex h-full w-full overflow-hidden">
        <Pane pane={panes[0]} />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <LayoutRenderer node={layout} paneById={paneById} />
    </div>
  )
}

interface LayoutRendererProps {
  node: LayoutNode
  paneById: (id: string) => PaneState | undefined
}

const LayoutRenderer = ({ node, paneById }: LayoutRendererProps) => {
  if (node.kind === 'leaf') {
    const pane = paneById(node.paneId)
    if (!pane) return null
    return <Pane pane={pane} />
  }
  return <Split node={node} paneById={paneById} />
}

interface SplitProps {
  node: Extract<LayoutNode, { kind: 'split' }>
  paneById: (id: string) => PaneState | undefined
}

// A split renders its two children with a draggable divider between
// them. Direction picks the axis: horizontal stacks side-by-side,
// vertical stacks top-over-bottom. The ratio (size of the FIRST child)
// is sourced from and written back to the layout tree.
const Split = ({ node, paneById }: SplitProps) => {
  const setLayoutRatio = useWorkspaceStore(s => s.setLayoutRatio)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ start: number; startRatio: number } | null>(null)

  // Pick a representative pane id from each subtree to identify the
  // divider when persisting the new ratio. setLayoutRatio matches a
  // split by ANY pair of pane ids that straddle it, so we just use the
  // first leaf on each side.
  const firstLeafId = (n: LayoutNode): string =>
    n.kind === 'leaf' ? n.paneId : firstLeafId(n.children[0])
  const leftId = firstLeafId(node.children[0])
  const rightId = firstLeafId(node.children[1])

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const isHorizontal = node.direction === 'horizontal'
    dragRef.current = {
      start: isHorizontal ? e.clientX : e.clientY,
      startRatio: node.ratio,
    }
    const handleMove = (ev: MouseEvent) => {
      if (!containerRef.current || !dragRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const total = isHorizontal ? rect.width : rect.height
      if (total <= 0) return
      const delta = ((isHorizontal ? ev.clientX : ev.clientY) - dragRef.current.start) / total
      const next = dragRef.current.startRatio + delta
      const clamped = Math.min(1 - MIN_PANE_RATIO, Math.max(MIN_PANE_RATIO, next))
      setLayoutRatio(leftId, rightId, clamped)
    }
    const handleUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = node.direction === 'horizontal' ? 'col-resize' : 'row-resize'
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [leftId, node.direction, node.ratio, rightId, setLayoutRatio])

  const isHorizontal = node.direction === 'horizontal'
  const containerClass = isHorizontal
    ? 'flex h-full w-full min-h-0 min-w-0 overflow-hidden flex-row'
    : 'flex h-full w-full min-h-0 min-w-0 overflow-hidden flex-col'
  const firstStyle: React.CSSProperties = isHorizontal
    ? { width: `${node.ratio * 100}%` }
    : { height: `${node.ratio * 100}%` }
  const secondStyle: React.CSSProperties = isHorizontal
    ? { width: `${(1 - node.ratio) * 100}%` }
    : { height: `${(1 - node.ratio) * 100}%` }
  const dividerClass = isHorizontal
    ? 'w-1 cursor-col-resize bg-obsidianBorder hover:bg-obsidianAccentPurple/60 flex-shrink-0 transition-colors'
    : 'h-1 cursor-row-resize bg-obsidianBorder hover:bg-obsidianAccentPurple/60 flex-shrink-0 transition-colors'

  return (
    <div ref={containerRef} className={containerClass}>
      <div style={firstStyle} className={`${isHorizontal ? 'flex' : 'flex flex-col'} min-w-0 min-h-0 flex-shrink-0`}>
        <LayoutRenderer node={node.children[0]} paneById={paneById} />
      </div>
      <div
        onMouseDown={onDividerMouseDown}
        className={dividerClass}
        title="Drag to resize"
        data-testid="editor-resize-handle"
        data-direction={node.direction}
      />
      <div style={secondStyle} className={`${isHorizontal ? 'flex' : 'flex flex-col'} min-w-0 min-h-0 flex-shrink-0`}>
        <LayoutRenderer node={node.children[1]} paneById={paneById} />
      </div>
    </div>
  )
}

export default Editor
