'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useUIStore,
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '@/stores'

// Keyboard step (px) when the handle is focused and the user presses
// the arrow keys. Shift multiplies for a coarser jump.
const KEY_STEP = 16
const KEY_STEP_LARGE = 64

// A vertical drag handle sitting on the RIGHT edge of the left sidebar.
// Drag it to set sidebarWidth; the value is clamped + persisted by
// useUIStore. Mirrors the horizontal resize affordance in
// SidebarSection: a wide (cursor-friendly) hit target with a subtle
// stripe at rest that lights up purple on hover/drag.
//
// Desktop only — the caller (page.tsx) renders this in the desktop
// layout branch, never in the mobile drawer.
export const SidebarResizeHandle = () => {
  const sidebarWidth = useUIStore(s => s.sidebarWidth)
  const setSidebarWidth = useUIStore(s => s.setSidebarWidth)

  // Track the in-flight width locally so the drag is smooth; commit to
  // the store on every move (cheap — the store no-ops when clamped value
  // is unchanged, and the persist write is debounced by the browser).
  const [dragging, setDragging] = useState(false)
  // startX = pointer X at mousedown; startW = sidebar width at mousedown.
  const startRef = useRef<{ x: number; w: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return
      const dx = e.clientX - startRef.current.x
      setSidebarWidth(startRef.current.w + dx)
    }
    const onUp = () => {
      setDragging(false)
      startRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // While dragging, kill text selection + force the resize cursor
    // everywhere so quick pointer overshoots past the handle don't
    // flicker the I-beam over editor text.
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
  }, [dragging, setSidebarWidth])

  const onMouseDown = (e: React.MouseEvent) => {
    // Left button only — right-click should never start a drag.
    if (e.button !== 0) return
    e.preventDefault()
    startRef.current = { x: e.clientX, w: sidebarWidth }
    setDragging(true)
  }

  // Double-click resets to the default width (Obsidian-style "snap back").
  const onDoubleClick = () => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  }

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          setSidebarWidth(sidebarWidth - step)
          break
        case 'ArrowRight':
          e.preventDefault()
          setSidebarWidth(sidebarWidth + step)
          break
        case 'Home':
          e.preventDefault()
          setSidebarWidth(MIN_SIDEBAR_WIDTH)
          break
        case 'End':
          e.preventDefault()
          setSidebarWidth(MAX_SIDEBAR_WIDTH)
          break
        default:
          break
      }
    },
    [sidebarWidth, setSidebarWidth],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={clampSidebarWidth(sidebarWidth)}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      data-testid="sidebar-resize-handle"
      // Pulled 2px into the editor track (negative margin) so the
      // 6px-wide grab zone straddles the visual border without adding
      // layout width. self-stretch keeps it full-height.
      className={`group relative z-10 -ml-[3px] w-[6px] flex-none cursor-col-resize self-stretch outline-none ${
        dragging ? 'bg-obsidianHighlight/40' : 'hover:bg-obsidianHighlight/20'
      } transition-colors focus-visible:bg-obsidianHighlight/30`}
    >
      {/* Subtle 1px stripe centred in the grab zone. User feedback
          2026-06-04 — the previous purple/blue hover tint was reading
          as a stray blue vertical line whenever the cursor moved
          near the sidebar/editor boundary. Switched to obsidianHighlight
          (#4d4d4d gray) so the affordance is still visible on hover
          but the colour doesn't fight the editor accent. */}
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

export default SidebarResizeHandle
