'use client'

import { useMemo, useState } from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useWorkspaceStore } from '@/stores'
import { searchNotes } from '@/utils/search'

// In-panel search for the sidebar's Search tab. Lighter than the
// Ctrl+K modal — no fuzzy ranking display, no thumbnails — just a
// filter input + title-matched result list. Clicking a row opens
// the note in the active pane.
//
// The Ctrl+K modal still exists for keyboard-driven power search;
// this panel is the always-visible-on-tab-click variant.
export const SidebarSearchPanel = () => {
  const notes = useNoteStore(s => s.notes)
  const openNote = useWorkspaceStore(s => s.openNote)
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    // Reuses the singleton Fuse index for consistency with Ctrl+K.
    // Cap to 50 rows so the panel doesn't paint a million lines for
    // a one-letter query.
    return searchNotes(notes, q).slice(0, 50)
  }, [notes, query])

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-obsidianBorder">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-obsidianSecondaryText pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search notes…"
            autoFocus
            data-testid="sidebar-search-input"
            className="w-full pl-7 pr-7 py-1.5 text-sm bg-obsidianDarkGray border border-obsidianBorder rounded-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-hidden focus:border-obsidianAccentPurple"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-obsidianSecondaryText hover:text-obsidianText"
              aria-label="Clear search"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!query.trim() ? (
          <p className="text-xs text-obsidianSecondaryText italic px-3 py-3">
            Start typing to search note titles and contents.
          </p>
        ) : results.length === 0 ? (
          <p className="text-xs text-obsidianSecondaryText italic px-3 py-3">
            No matches for &quot;{query}&quot;.
          </p>
        ) : (
          <ul className="py-1">
            {results.map(r => (
              <li key={r.noteId}>
                <button
                  type="button"
                  onClick={() => openNote(r.noteId, { preview: true })}
                  className="w-full text-left px-3 py-1.5 text-sm text-obsidianText hover:bg-obsidianHighlight/40 truncate"
                  title={r.title}
                  data-testid={`sidebar-search-result-${r.noteId}`}
                >
                  {r.title || 'Untitled'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default SidebarSearchPanel
