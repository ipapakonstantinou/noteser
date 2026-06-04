'use client'

import { useEffect, useRef } from 'react'
import {
  DocumentTextIcon,
  DocumentPlusIcon,
  ViewColumnsIcon,
  LinkIcon,
  BookmarkIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'

// Right-click menu for a calendar day cell. Surfaces the day-level
// actions Obsidian shows on a note (Open / Open in new pane / Copy
// wikilink / Bookmark / Delete) plus the day-specific "Create daily
// note" affordance when the day doesn't have one yet.
//
// `hasDailyNote` toggles between the two item sets:
//   • has a note  → Open / Open in new pane / Copy wikilink /
//                   Add to bookmarks (or Remove) / Delete daily note
//   • no note yet → Create daily note (same as the left-click flow,
//                   surfaced here for discoverability)
//
// Positioned fixed at (x, y) from the right-click event. Closes on
// outside-click, Escape, or selecting an item. Edge-clamps to the
// viewport like TabContextMenu so a menu near the bottom-right corner
// doesn't render off-screen.

export interface CalendarDayContextMenuProps {
  x: number
  y: number
  hasDailyNote: boolean
  isBookmarked: boolean
  onOpenDailyNote: () => void
  onOpenInNewPane: () => void
  onCopyWikilink: () => void
  onToggleBookmark: () => void
  onDeleteDailyNote: () => void
  onCreateDailyNote: () => void
  onDismiss: () => void
}

export const CalendarDayContextMenu = ({
  x,
  y,
  hasDailyNote,
  isBookmarked,
  onOpenDailyNote,
  onOpenInNewPane,
  onCopyWikilink,
  onToggleBookmark,
  onDeleteDailyNote,
  onCreateDailyNote,
  onDismiss,
}: CalendarDayContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)

  // Outside-click + Escape dismiss. Item-clicks call their own action
  // (which the parent then translates into a dismiss); we only fire
  // onDismiss for the "user backed out without picking anything" path.
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

  // Clamp to viewport — same logic as TabContextMenu. Run once after
  // mount when the menu has dimensions; no resize listener because the
  // menu is short-lived (one user interaction).
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
      className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[220px] z-50"
      style={{ top: y, left: x }}
      role="menu"
      data-testid="calendar-day-context-menu"
    >
      {hasDailyNote ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={onOpenDailyNote}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
            data-testid="calendar-day-context-open"
          >
            <DocumentTextIcon className="w-4 h-4" />
            Open daily note
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onOpenInNewPane}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
            data-testid="calendar-day-context-split"
          >
            <ViewColumnsIcon className="w-4 h-4" />
            Open in new pane (split right)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onCopyWikilink}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
            data-testid="calendar-day-context-copy-wikilink"
          >
            <LinkIcon className="w-4 h-4" />
            Copy wikilink
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onToggleBookmark}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
            data-testid="calendar-day-context-bookmark"
          >
            <BookmarkIcon className="w-4 h-4" />
            {isBookmarked ? 'Remove from bookmarks' : 'Add to bookmarks'}
          </button>
          <div className="my-1 border-t border-obsidianBorder" />
          <button
            type="button"
            role="menuitem"
            onClick={onDeleteDailyNote}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-900/30"
            data-testid="calendar-day-context-delete"
          >
            <TrashIcon className="w-4 h-4" />
            Delete daily note
          </button>
        </>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={onCreateDailyNote}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
          data-testid="calendar-day-context-create"
        >
          <DocumentPlusIcon className="w-4 h-4" />
          Create daily note
        </button>
      )}
    </div>
  )
}

export default CalendarDayContextMenu
