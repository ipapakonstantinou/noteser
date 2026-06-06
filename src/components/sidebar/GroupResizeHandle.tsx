'use client'

import { useEffect, useRef, useState } from 'react'
import { MIN_GROUP_HEIGHT } from '@/stores/settingsStore'

// Vertical drag handle sitting between two stacked sidebar groups.
// Drag down to grow the group ABOVE + shrink the group BELOW; drag up
// to reverse. Double-click releases both heights (null = flex
// distribution), giving the user a quick "snap back" gesture matching
// the behaviour of the horizontal SidebarResizeHandle.
//
// The component is a thin gesture wrapper — measuring + committing the
// heights is delegated to the caller via `onResize`. The caller owns
// the source of truth (settingsStore.sidebarGroups[i].height); we only
// emit deltas. That keeps the handle reusable on both the LEFT and
// RIGHT sidebars (Change B) with zero coupling to the registry.
export interface GroupResizeHandleProps {
  // Current pixel height of the group ABOVE this handle. Used as the
  // starting reference point for the drag arithmetic.
  aboveHeight: number
  // Current pixel height of the group BELOW. Same role as aboveHeight.
  belowHeight: number
  // Called continuously while dragging with the candidate next heights
  // for the two adjacent groups (already clamped to MIN_GROUP_HEIGHT).
  // The caller persists by calling its `setGroupHeight` setter.
  onResize: (nextAbove: number, nextBelow: number) => void
  // Called on double-click — caller should release both groups back to
  // flex distribution (setGroupHeight(..., null)).
  onReset: () => void
  // Optional label used for the ARIA name. Defaults to "Resize groups".
  ariaLabel?: string
}

export const GroupResizeHandle = ({
  aboveHeight,
  belowHeight,
  onResize,
  onReset,
  ariaLabel = 'Resize groups',
}: GroupResizeHandleProps) => {
  const [dragging, setDragging] = useState(false)
  // Capture the pointer start + both starting heights at mousedown so
  // moves are computed against the original positions, not the
  // last-frame's value (avoids floating-point drift over a long drag).
  const startRef = useRef<{ y: number; above: number; below: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return
      const dy = e.clientY - startRef.current.y
      const total = startRef.current.above + startRef.current.below
      // Clamp BOTH ends so neither group can be squeezed below the
      // minimum. Whichever end hits the floor first stops moving — the
      // other side keeps the remaining budget.
      let nextAbove = startRef.current.above + dy
      let nextBelow = startRef.current.below - dy
      if (nextAbove < MIN_GROUP_HEIGHT) {
        nextAbove = MIN_GROUP_HEIGHT
        nextBelow = total - MIN_GROUP_HEIGHT
      } else if (nextBelow < MIN_GROUP_HEIGHT) {
        nextBelow = MIN_GROUP_HEIGHT
        nextAbove = total - MIN_GROUP_HEIGHT
      }
      onResize(nextAbove, nextBelow)
    }
    const onUp = () => {
      setDragging(false)
      startRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // Same "kill text selection + force cursor" trick as the column
    // resize handle so a quick pointer overshoot doesn't flicker the
    // I-beam across the editor.
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
    }
  }, [dragging, onResize])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    startRef.current = { y: e.clientY, above: aboveHeight, below: belowHeight }
    setDragging(true)
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      data-testid="sidebar-group-resize-handle"
      className={`group relative h-2 cursor-row-resize flex-shrink-0 flex items-center justify-center ${
        dragging ? 'bg-obsidianAccentPurple' : 'hover:bg-obsidianAccentPurple/30'
      } transition-colors`}
    >
      {!dragging && (
        <span className="block w-8 h-[2px] rounded-full bg-obsidianBorder group-hover:bg-obsidianAccentPurple/80 transition-colors" />
      )}
    </div>
  )
}

export default GroupResizeHandle
