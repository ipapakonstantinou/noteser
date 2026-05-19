'use client'

import { useMemo } from 'react'
import { useNoteStore, useWorkspaceStore } from '@/stores'
import { useHydration } from '@/hooks'
import { extractHeadings } from '@/utils/outline'
import { SCROLL_TO_LINE_EVENT } from '@/utils/events'

// Sidebar's Outline panel: lists the H1-H6 headings of the active note in
// document order and jumps the editor to a heading on click. The CodeMirror
// view ref lives in EditorContent; we communicate via the
// `noteser:scroll-to-line` window event so this component stays decoupled
// from the editor internals.

export const OutlineView = () => {
  const hydrated = useHydration()

  // Reach into the workspace store for the *active* tab's note. We watch the
  // active pane + active tab, then resolve to a note id when the tab is a
  // note (vs a merge-conflict tab).
  const activeNoteId = useWorkspaceStore(s => {
    const pane = s.panes.find(p => p.id === s.activePaneId) ?? s.panes[0]
    if (!pane) return null
    const tab = pane.tabs.find(t => t.id === pane.activeTabId)
    return tab && tab.kind === 'note' ? tab.noteId : null
  })

  // Subscribe to the note's content so the outline re-parses on every edit.
  // Selecting just `content` keeps the re-render scope tight.
  const activeNoteContent = useNoteStore(s => {
    if (!activeNoteId) return null
    return s.notes.find(n => n.id === activeNoteId)?.content ?? null
  })
  const activeNoteTitle = useNoteStore(s => {
    if (!activeNoteId) return null
    return s.notes.find(n => n.id === activeNoteId)?.title ?? null
  })

  const headings = useMemo(
    () => extractHeadings(activeNoteContent ?? ''),
    [activeNoteContent],
  )

  const jumpTo = (line: number) => {
    if (!activeNoteId || typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent(SCROLL_TO_LINE_EVENT, {
        detail: { noteId: activeNoteId, line },
      }),
    )
  }

  if (!hydrated) {
    return (
      <div className="px-1">
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
          Outline
        </h3>
      </div>
    )
  }

  if (!activeNoteId) {
    return (
      <div className="px-1 space-y-3">
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
          Outline
        </h3>
        <p className="text-sm text-obsidianSecondaryText italic">
          Open a note to see its outline.
        </p>
      </div>
    )
  }

  return (
    <div className="px-1 space-y-3">
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
          Outline
        </h3>
        {activeNoteTitle && (
          <div
            className="text-xs text-obsidianSecondaryText truncate"
            title={activeNoteTitle}
          >
            {activeNoteTitle}
          </div>
        )}
      </div>

      {headings.length === 0 ? (
        <p className="text-sm text-obsidianSecondaryText italic">
          No headings in this note.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {headings.map((h, idx) => (
            <li key={`${h.line}-${idx}`}>
              <button
                onClick={() => jumpTo(h.line)}
                // Indent by level — level 1 has no extra padding, each deeper
                // level adds 12px so a six-level outline stays readable in
                // the 256px sidebar.
                style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                className={`block w-full text-left text-sm truncate px-1 py-0.5 rounded transition-colors hover:bg-obsidianDarkGray hover:text-obsidianAccentPurple ${
                  h.level === 1
                    ? 'text-obsidianText font-medium'
                    : 'text-obsidianSecondaryText'
                }`}
                title={h.text}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default OutlineView
