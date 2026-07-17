'use client'

import { useMemo } from 'react'
import { LinkSlashIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useWorkspaceStore } from '@/stores'
import { useHydration } from '@/hooks'
import { findBrokenWikilinks, type BrokenLink } from '@/utils/brokenLinks'
import { resolveAttachmentPath } from '@/utils/attachments'
import { SCROLL_TO_LINE_EVENT } from '@/utils/events'

// Sidebar's Broken Links panel: scans every note in the vault for
// `[[Target]]` / `![[Target]]` occurrences that don't resolve to an
// existing note or attachment, grouped by the note they appear in.
// Mirrors BacklinksView's structure/styling for consistency.
export const BrokenLinksView = () => {
  const hydrated = useHydration()

  const notes = useNoteStore(s => s.notes)
  const openNote = useWorkspaceStore(s => s.openNote)

  const results = useMemo(
    () => findBrokenWikilinks(notes, { resolveAttachment: resolveAttachmentPath }),
    [notes],
  )

  const totalLinks = results.reduce((n, r) => n + r.links.length, 0)

  const jumpTo = (noteId: string, line: number) => {
    openNote(noteId, { preview: false })
    if (typeof window === 'undefined') return
    // Two-frame defer so the pane has switched its active tab and the
    // target note's editor has mounted before we ask it to scroll —
    // same defer used by revealNote.ts for the folder-tree jump.
    const raf = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)
    raf(() => raf(() => {
      window.dispatchEvent(new CustomEvent(SCROLL_TO_LINE_EVENT, { detail: { noteId, line } }))
    }))
  }

  if (!hydrated) {
    return (
      <div className="text-center py-8 text-obsidianSecondaryText text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="px-1 space-y-4">
      <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
        Broken links
      </h3>

      {results.length === 0 ? (
        <div className="text-center py-8 text-obsidianSecondaryText">
          <LinkSlashIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm italic">No broken links found.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
            {totalLinks} link{totalLinks === 1 ? '' : 's'} in {results.length} note{results.length === 1 ? '' : 's'}
          </div>
          <ul className="space-y-3">
            {results.map(r => (
              <li key={r.noteId}>
                <button
                  onClick={() => openNote(r.noteId, { preview: false })}
                  className="w-full text-left rounded-sm px-2 py-1 hover:bg-obsidianDarkGray transition-colors group"
                  title={r.title}
                >
                  <div className="text-sm text-obsidianText truncate group-hover:text-obsidianAccentPurple">
                    {r.title}
                  </div>
                </button>
                <ul className="mt-0.5 space-y-0.5">
                  {r.links.map((link, idx) => (
                    <li key={idx}>
                      <button
                        onClick={() => jumpTo(r.noteId, link.line)}
                        className="w-full text-left rounded-sm px-2 py-1 hover:bg-obsidianDarkGray transition-colors"
                        title={`Line ${link.line}`}
                      >
                        <BrokenLinkLabel link={link} />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const BrokenLinkLabel = ({ link }: { link: BrokenLink }) => (
  <span className="text-[11px] text-obsidianSecondaryText leading-snug">
    <span className="font-semibold text-red-400">
      {link.isEmbed ? '![[' : '[['}
      {link.target}
      {link.fragment ? `#${link.fragment}` : ''}
      ]]
    </span>
    <span className="ml-2 text-obsidianSecondaryText/70">line {link.line}</span>
  </span>
)

export default BrokenLinksView
