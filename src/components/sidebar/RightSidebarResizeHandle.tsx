'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useUIStore,
  clampRightSidebarWidth,
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  MAX_RIGHT_SIDEBAR_WIDTH,
} from '@/stores'

// Mirror of `SidebarResizeHandle` but driving `uiStore.rightSidebarWidth`.
// Lives on the LEFT edge of the right sidebar column. Drag direction
// is INVERTED relative to the left handle — moving the cursor LEFT
// grows the right sidebar (it claims more screen real estate), moving
// it RIGHT shrinks it.
const KEY_STEP = 16
const KEY_STEP_LARGE = 64

export const RightSidebarResizeHandle = () => {
  const rightSidebarWidth = useUIStore(s => s.rightSidebarWidth)
  const setRightSidebarWidth = useUIStore(s => s.setRightSidebarWidth)

  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; w: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return
      const dx = e.clientX - startRef.current.x
      // Inverted: dragging the pointer LEFT (negative dx) increases
      // the width (right sidebar eats more screen) and vice versa.
      setRightSidebarWidth(startRef.current.w - dx)
    }
    const onUp = () => {
      setDragging(false)
      startRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
    }
  }, [dragging, setRightSidebarWidth])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    startRef.current = { x: e.clientX, w: rightSidebarWidth }
    setDragging(true)
  }

  const onDoubleClick = () => {
    setRightSidebarWidth(DEFAULT_RIGHT_SIDEBAR_WIDTH)
  }

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
      switch (e.key) {
        // Same "inverted" mapping as the drag: left arrow grows the
        // sidebar, right shrinks it. Matches the visual model of
        // pulling the divider away from the editor.
        case 'ArrowLeft':
          e.preventDefault()
          setRightSidebarWidth(rightSidebarWidth + step)
          break
        case 'ArrowRight':
          e.preventDefault()
          setRightSidebarWidth(rightSidebarWidth - step)
          break
        case 'Home':
          e.preventDefault()
          setRightSidebarWidth(MAX_RIGHT_SIDEBAR_WIDTH)
          break
        case 'End':
          e.preventDefault()
          setRightSidebarWidth(MIN_RIGHT_SIDEBAR_WIDTH)
          break
        default:
          break
      }
    },
    [rightSidebarWidth, setRightSidebarWidth],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize right sidebar"
      aria-valuenow={clampRightSidebarWidth(rightSidebarWidth)}
      aria-valuemin={MIN_RIGHT_SIDEBAR_WIDTH}
      aria-valuemax={MAX_RIGHT_SIDEBAR_WIDTH}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      data-testid="right-sidebar-resize-handle"
      className={`group relative z-10 -mr-[3px] w-[6px] flex-none cursor-col-resize self-stretch outline-none ${
        dragging ? 'bg-obsidianHighlight/40' : 'hover:bg-obsidianHighlight/20'
      } transition-colors focus-visible:bg-obsidianHighlight/30`}
    >
      <span
        className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 ${
          dragging
            ? 'bg-obsidianHighlight'
            : 'bg-transparent group-hover:bg-obsidianHighlight/70 group-focus-visible:bg-obsidianHighlight/70'
        } transition-colors`}
      />
    </div>
  )
}

export default RightSidebarResizeHandle
