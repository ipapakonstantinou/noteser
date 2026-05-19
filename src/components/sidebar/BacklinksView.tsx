'use client'

import { useMemo } from 'react'
import { LinkIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useWorkspaceStore } from '@/stores'
import { useHydration } from '@/hooks'
import { findBacklinks, type BacklinkSnippet } from '@/utils/backlinks'

// Sidebar's Backlinks panel: lists every other note whose body wikilinks to
// the currently open note (by title OR alias). Mirrors the structure /
// styling of GitHubView.tsx for visual consistency.
export const BacklinksView = () => {
  const hydrated = useHydration()

  const notes = useNoteStore(s => s.notes)
  // The active note id is tracked by useNoteStore.selectedNoteId, which the
  // workspace store keeps in sync with the active pane's active note tab.
  const selectedNoteId = useNoteStore(s => s.selectedNoteId)
  const openNote = useWorkspaceStore(s => s.openNote)

  const targetNote = useMemo(() => {
    if (!selectedNoteId) return null
    return notes.find(n => n.id === selectedNoteId) ?? null
  }, [notes, selectedNoteId])

  const results = useMemo(() => {
    if (!targetNote) return []
    return findBacklinks(notes, targetNote)
    // We deliberately recompute on every notes change. With a few thousand
    // notes this is well under a frame; if it ever shows up in a profile we
    // can switch to a content-hash key.
  }, [notes, targetNote])

  if (!hydrated) {
    return (
      <div className="text-center py-8 text-obsidianSecondaryText text-sm">
        Loading…
      </div>
    )
  }

  if (!targetNote) {
    return (
      <div className="px-1 space-y-4">
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
          Backlinks
        </h3>
        <div className="text-center py-8 text-obsidianSecondaryText">
          <LinkIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Open a note to see its backlinks.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-1 space-y-4">
      <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
        Backlinks
      </h3>

      {/* Active note header */}
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
          Linking to
        </div>
        <div
          className="text-sm text-obsidianText truncate"
          title={targetNote.title}
        >
          {targetNote.title || '(untitled)'}
        </div>
      </div>

      {/* Results */}
      {results.length === 0 ? (
        <div className="text-center py-6 text-obsidianSecondaryText">
          <p className="text-sm italic">No backlinks to this note yet.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
            {results.length} note{results.length === 1 ? '' : 's'}
          </div>
          <ul className="space-y-2">
            {results.map(r => (
              <li key={r.noteId}>
                <button
                  onClick={() => openNote(r.noteId, { preview: false })}
                  className="w-full text-left rounded px-2 py-1.5 hover:bg-obsidianDarkGray transition-colors group"
                  title={r.title}
                >
                  <div className="text-sm text-obsidianText truncate group-hover:text-obsidianAccentPurple">
                    {r.title}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {r.snippets.map((snip, idx) => (
                      <li
                        key={idx}
                        className="text-[11px] text-obsidianSecondaryText leading-snug"
                      >
                        <SnippetWithHighlight snippet={snip} />
                      </li>
                    ))}
                  </ul>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Render the snippet text, bolding any `[[…]]` wikilink occurrences so the
// matched link visually pops out. We don't try to selectively highlight only
// the *matching* link — if a snippet happens to contain another wikilink in
// the surrounding chars, that one gets bolded too. Harmless and simpler.
//
// Note: String.prototype.split with a capturing group preserves the captured
// delimiters in the result. Even-index parts are plain text, odd-index parts
// are the captured `[[…]]` matches — no need to re-test each fragment.
const WIKILINK_SPLIT = /(\[\[[^\]]+?\]\])/g

const SnippetWithHighlight = ({ snippet }: { snippet: BacklinkSnippet }) => {
  const parts = snippet.text.split(WIKILINK_SPLIT)
  return (
    <>
      {parts.map((part, idx) =>
        idx % 2 === 1 ? (
          <span
            key={idx}
            className="font-semibold text-obsidianAccentPurple"
          >
            {part}
          </span>
        ) : (
          <span key={idx}>{part}</span>
        ),
      )}
    </>
  )
}

export default BacklinksView
