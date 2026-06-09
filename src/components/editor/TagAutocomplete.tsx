'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HashtagIcon } from '@heroicons/react/24/outline'

interface TagAutocompleteProps {
  query: string
  // Map<tagName, occurrenceCount> from collectAllTags — caller decides
  // the source. Sorted by count (desc) then name (asc) so the heaviest-
  // used tags come first.
  tags: Map<string, number>
  position: { top: number; left: number }
  onSelect: (tag: string) => void
  onClose: () => void
}

interface Row { name: string; count: number }

export function TagAutocomplete({ query, tags, position, onSelect, onClose }: TagAutocompleteProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo<Row[]>(() => {
    const q = query.toLowerCase()
    const rows: Row[] = []
    for (const [name, count] of tags) {
      if (q === '' || name.toLowerCase().includes(q)) {
        rows.push({ name, count })
      }
    }
    rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return rows.slice(0, 8)
  }, [tags, query])

  useEffect(() => setActiveIndex(0), [query])
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }) }, [activeIndex])

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
          onSelect(filtered[activeIndex].name)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === ' ') {
        // Space dismisses the dropdown but lets the space character land in
        // the editor — close without preventDefault so CodeMirror still gets
        // the input.
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [filtered, activeIndex, onSelect, onClose])

  if (filtered.length === 0 || typeof document === 'undefined') return null

  const DROPDOWN_HEIGHT = Math.min(filtered.length, 8) * 36
  const flipUp = position.top + DROPDOWN_HEIGHT > window.innerHeight - 16
  const top = flipUp ? position.top - DROPDOWN_HEIGHT - 4 : position.top + 4

  return createPortal(
    <div
      className="fixed z-[9999] bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian overflow-hidden min-w-[200px] max-w-[320px] max-h-72 overflow-y-auto"
      style={{ top, left: position.left }}
      data-testid="tag-autocomplete"
    >
      {filtered.map(({ name, count }, i) => (
        <div
          key={name}
          ref={i === activeIndex ? activeRef : null}
          className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors ${
            i === activeIndex
              ? 'bg-obsidianHighlight text-obsidianText'
              : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
          }`}
          onMouseDown={e => { e.preventDefault(); onSelect(name) }}
          onMouseEnter={() => setActiveIndex(i)}
          data-testid={`tag-row-${name}`}
        >
          <HashtagIcon className="w-4 h-4 flex-shrink-0" />
          <span className="truncate flex-1">{name}</span>
          <span className="text-xs text-obsidianSecondaryText/70 tabular-nums">{count}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}
