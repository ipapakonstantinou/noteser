'use client'

import { useEffect, useRef } from 'react'
import {
  ArrowUpOnSquareIcon,
  ArrowDownOnSquareIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'

// Lightweight popup menu for right-clicking a sidebar tab icon.
//
// Replaces the previous "right-click = instant pin/unpin" behaviour
// (Telegram feedback 2026-05-22: instant action felt surprising). The
// menu shows Pin or Unpin depending on `location`, plus Hide. Settings →
// Sidebar lets the user unhide.
//
// Position is fixed to (x, y) from the right-click event. Closes on
// outside-click, Escape, or selecting an item. Keeps state-shape tight
// — the parent SidebarStack owns the open/close state and the handlers
// so the same instance serves both strips.

export type TabContextMenuLocation = 'bottom' | 'pinned'

export interface TabContextMenuProps {
  x: number
  y: number
  location: TabContextMenuLocation
  onPin: () => void
  onUnpin: () => void
  onHide: () => void
  onClose: () => void
}

export const TabContextMenu = ({
  x, y, location, onPin, onUnpin, onHide, onClose,
}: TabContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)

  // Outside-click + Escape close.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp to viewport so a right-click near the bottom doesn't render
  // the menu off-screen. We do this on mount via ref measurement —
  // same pattern the note ContextMenu uses.
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`
    }
  }, [])

  const isPinned = location === 'pinned'

  return (
    <div
      ref={menuRef}
      className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[180px] z-50"
      style={{ top: y, left: x }}
      role="menu"
      data-testid="tab-context-menu"
    >
      {isPinned ? (
        <button
          type="button"
          role="menuitem"
          onClick={onUnpin}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
          data-testid="tab-context-menu-unpin"
        >
          <ArrowDownOnSquareIcon className="w-4 h-4" />
          Unpin
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={onPin}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
          data-testid="tab-context-menu-pin"
        >
          <ArrowUpOnSquareIcon className="w-4 h-4" />
          Pin to top
        </button>
      )}
      <div className="my-1 border-t border-obsidianBorder" />
      <button
        type="button"
        role="menuitem"
        onClick={onHide}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
        data-testid="tab-context-menu-hide"
      >
        <EyeSlashIcon className="w-4 h-4" />
        Hide tab
      </button>
    </div>
  )
}

export default TabContextMenu
