'use client'

import { useMemo } from 'react'
import { BookmarkIcon, StarIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useWorkspaceStore } from '@/stores'

// Bookmarks panel (v1) — surfaces pinned notes. The Note model already
// has `isPinned` toggled via the context menu's "Pin to top" action; we
// reuse that as the bookmark store rather than introducing a new
// entity. A full Obsidian-style bookmarks tree with custom groups can
// come later — pinned notes cover 90% of the use case.
export const SidebarBookmarksPanel = () => {
  const notes = useNoteStore(s => s.notes)
  const openNote = useWorkspaceStore(s => s.openNote)

  const pinned = useMemo(
    () => notes
      .filter(n => !n.isDeleted && n.isPinned)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [notes],
  )

  if (pinned.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-obsidianSecondaryText space-y-2">
        <div className="flex items-center gap-1.5">
          <BookmarkIcon className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wide font-medium">Bookmarks</span>
        </div>
        <p className="italic">
          Pin notes from the right-click menu to see them here.
        </p>
      </div>
    )
  }

  return (
    <ul className="py-1">
      {pinned.map(note => (
        <li key={note.id}>
          <button
            type="button"
            onClick={() => openNote(note.id, { preview: false })}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-obsidianText hover:bg-obsidianHighlight/40 truncate"
            title={note.title}
            data-testid={`sidebar-bookmark-${note.id}`}
          >
            <StarIcon className="w-3.5 h-3.5 flex-none text-yellow-400" />
            <span className="truncate">{note.title || 'Untitled'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default SidebarBookmarksPanel
