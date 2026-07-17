'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import type { Note } from '@/types'
import { getAliasesForNote } from '@/utils/aliases'

interface WikilinkAutocompleteProps {
  query: string
  notes: Note[]
  position: { top: number; left: number }
  onSelect: (note: Note) => void
  onClose: () => void
}

// Result row carries the note + (optional) alias that produced the match, so
// the dropdown can render "Title (alias: Short Name)" — same affordance
// Obsidian shows when the typed query hit an alias rather than the title.
interface AutocompleteRow {
  note: Note
  matchedAlias: string | null
}

export function WikilinkAutocomplete({
  query,
  notes,
  position,
  onSelect,
  onClose,
}: WikilinkAutocompleteProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo<AutocompleteRow[]>(() => {
    const q = query.toLowerCase()
    const rows: AutocompleteRow[] = []
    for (const note of notes) {
      if (note.title.toLowerCase().includes(q)) {
        rows.push({ note, matchedAlias: null })
        continue
      }
      // Title didn't match — check aliases. We show the FIRST alias that
      // matched the query so the user can see why this row appeared.
      const aliases = getAliasesForNote(note)
      const hit = aliases.find(a => a.toLowerCase().includes(q))
      if (hit) rows.push({ note, matchedAlias: hit })
    }
    // Newest first. Titles here are overwhelmingly dated daily notes, and with the
    // 8-row cap an ascending order surfaces only the OLDEST matches — typing "[[202"
    // offered 2024 and never reached this year.
    rows.sort((a, b) => b.note.title.localeCompare(a.note.title))
    return rows.slice(0, 8)
  }, [notes, query])

  useEffect(() => setActiveIndex(0), [query])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(i => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[activeIndex]) {
          e.preventDefault()
          onSelect(filtered[activeIndex].note)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [filtered, activeIndex, onSelect, onClose])

  if (filtered.length === 0 || typeof document === 'undefined') return null

  // Flip above cursor if near bottom of viewport
  const DROPDOWN_HEIGHT = Math.min(filtered.length, 8) * 36
  const flipUp = position.top + DROPDOWN_HEIGHT > window.innerHeight - 16
  const top = flipUp ? position.top - DROPDOWN_HEIGHT - 4 : position.top + 4

  return createPortal(
    <div
      className="fixed z-9999 bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian overflow-hidden min-w-[200px] max-w-[320px] max-h-72 overflow-y-auto"
      style={{ top, left: position.left }}
    >
      {filtered.map(({ note, matchedAlias }, i) => (
        <div
          key={note.id}
          data-testid="wikilink-row"
          ref={i === activeIndex ? activeRef : null}
          className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors ${
            i === activeIndex
              ? 'bg-obsidianHighlight text-obsidianText'
              : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
          }`}
          onMouseDown={e => {
            e.preventDefault() // keep textarea focused
            onSelect(note)
          }}
          onMouseEnter={() => setActiveIndex(i)}
        >
          <DocumentTextIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">{note.title}</span>
          {matchedAlias && (
            <span className="truncate text-xs text-obsidianSecondaryText/70 italic">
              (alias: {matchedAlias})
            </span>
          )}
        </div>
      ))}
    </div>,
    document.body
  )
}
