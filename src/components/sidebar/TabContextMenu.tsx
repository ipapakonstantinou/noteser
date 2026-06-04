'use client'

import { useEffect, useRef } from 'react'
import {
  XMarkIcon,
  ArrowsPointingOutIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'

// Lightweight popup menu for right-clicking a sidebar tab icon (or a
// panel icon in the activity bar). Leaf model (2026-06-04): the menu
// surfaces three actions for tabs that live in a group —
//
//   • Close: remove this tab from its group. If the tab was the last
//     one in the group, the group itself is dropped.
//   • Move to new group: yank the tab out and spawn a fresh group
//     directly below the source group.
//   • Hide: hide the panel entirely (adds to hiddenSidebarTabs).
//     Restore via Settings → Sidebar.
//
// Position is fixed to (x, y) from the right-click event. Closes on
// outside-click, Escape, or selecting an item.

export interface TabContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onMoveToNewGroup: () => void
  onHide: () => void
  // Called when the menu should dismiss WITHOUT performing any action
  // (Escape, outside click, etc.). Separate from the per-item handlers
  // so the parent doesn't fire close-tab on a stray outside click.
  onDismiss: () => void
}

export const TabContextMenu = ({
  x, y, onClose, onMoveToNewGroup, onHide, onDismiss,
}: TabContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)

  // Outside-click + Escape dismiss (no action).
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onDismiss])

  // Clamp to viewport so a right-click near the bottom doesn't render
  // the menu off-screen.
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

  return (
    <div
      ref={menuRef}
      className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[200px] z-50"
      style={{ top: y, left: x }}
      role="menu"
      data-testid="tab-context-menu"
    >
      <button
        type="button"
        role="menuitem"
        onClick={onClose}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
        data-testid="tab-context-menu-close"
      >
        <XMarkIcon className="w-4 h-4" />
        Close
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onMoveToNewGroup}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
        data-testid="tab-context-menu-move-to-new-group"
      >
        <ArrowsPointingOutIcon className="w-4 h-4" />
        Move to new group
      </button>
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
