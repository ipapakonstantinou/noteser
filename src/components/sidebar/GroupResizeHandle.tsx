'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MIN_GROUP_HEIGHT } from '@/stores/settingsStore'

// Keyboard step (px) when the handle is focused and the user presses the
// arrow keys. Shift multiplies for a coarser jump. Mirrors the constants
// on the horizontal SidebarResizeHandle so both affordances feel the same.
const KEY_STEP = 16
const KEY_STEP_LARGE = 64

// Trade `delta` pixels between the two adjacent groups while keeping their
// combined height (`total`) constant, clamping BOTH ends so neither group
// can be squeezed below MIN_GROUP_HEIGHT. Whichever end hits the floor
// first stops moving; the other side keeps the remaining budget. Shared by
// the drag (mousemove) and keyboard paths so they can't drift apart.
function resolvePair(nextAbove: number, total: number): { above: number; below: number } {
  let above = nextAbove
  let below = total - nextAbove
  if (above < MIN_GROUP_HEIGHT) {
    above = MIN_GROUP_HEIGHT
    below = total - MIN_GROUP_HEIGHT
  } else if (below < MIN_GROUP_HEIGHT) {
    below = MIN_GROUP_HEIGHT
    above = total - MIN_GROUP_HEIGHT
  }
  return { above, below }
}

// Vertical drag handle sitting between two stacked sidebar groups.
// Drag down to grow the group ABOVE + shrink the group BELOW; drag up
// to reverse. Double-click releases both heights (null = flex
// distribution), giving the user a quick "snap back" gesture matching
// the behaviour of the horizontal SidebarResizeHandle.
//
// Keyboard parity with the horizontal handle: focus the separator and use
// ArrowUp / ArrowDown to nudge the boundary (Shift for a coarser step),
// Home / End to push it to either extreme. The component exposes the
// standard ARIA separator value range so screen readers announce the
// resize.
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
    // Shared move path for mouse AND touch — both reduce to "the pointer
    // is now at clientY", and the pair arithmetic is identical.
    const moveTo = (clientY: number) => {
      if (!startRef.current) return
      const dy = clientY - startRef.current.y
      const total = startRef.current.above + startRef.current.below
      const { above, below } = resolvePair(startRef.current.above + dy, total)
      onResize(above, below)
    }
    const onMove = (e: MouseEvent) => moveTo(e.clientY)
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t) moveTo(t.clientY)
    }
    const onUp = () => {
      setDragging(false)
      startRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // Touch parity (#177): the sidebar stack also renders inside the
    // mobile drawer, so the same drag has to work with a finger. The
    // handle carries `touch-none` (touch-action: none) so the browser
    // never claims the gesture for scrolling — no preventDefault needed,
    // which keeps the listeners passive-friendly.
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onUp)
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
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
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

  // Touch counterpart of onMouseDown. No preventDefault — React registers
  // touchstart passively, and the `touch-none` class already stops the
  // browser from scrolling the stack while the finger is on the handle.
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    e.stopPropagation()
    startRef.current = { y: t.clientY, above: aboveHeight, below: belowHeight }
    setDragging(true)
  }

  // Keyboard resize. ArrowDown grows the group above (boundary moves
  // down), ArrowUp shrinks it — matching the drag direction. Home / End
  // push the boundary to either extreme within the pair's budget.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const total = aboveHeight + belowHeight
      const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
      let targetAbove: number
      switch (e.key) {
        case 'ArrowDown':
          targetAbove = aboveHeight + step
          break
        case 'ArrowUp':
          targetAbove = aboveHeight - step
          break
        case 'Home':
          targetAbove = MIN_GROUP_HEIGHT
          break
        case 'End':
          targetAbove = total - MIN_GROUP_HEIGHT
          break
        default:
          return
      }
      e.preventDefault()
      const { above, below } = resolvePair(targetAbove, total)
      onResize(above, below)
    },
    [aboveHeight, belowHeight, onResize],
  )

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(aboveHeight)}
      aria-valuemin={MIN_GROUP_HEIGHT}
      aria-valuemax={Math.round(aboveHeight + belowHeight - MIN_GROUP_HEIGHT)}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      data-testid="sidebar-group-resize-handle"
      className={`group relative h-2 touch-none cursor-row-resize shrink-0 flex items-center justify-center outline-hidden ${
        dragging
          ? 'bg-obsidianAccentPurple'
          : 'hover:bg-obsidianAccentPurple/30 focus-visible:bg-obsidianAccentPurple/30'
      } transition-colors`}
    >
      {!dragging && (
        <span className="block w-8 h-[2px] rounded-full bg-obsidianBorder group-hover:bg-obsidianAccentPurple/80 group-focus-visible:bg-obsidianAccentPurple/80 transition-colors" />
      )}
    </div>
  )
}

export default GroupResizeHandle
