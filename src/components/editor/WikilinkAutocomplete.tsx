'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import type { Note } from '@/types'

interface WikilinkAutocompleteProps {
  query: string
  notes: Note[]
  position: { top: number; left: number }
  onSelect: (note: Note) => void
  onClose: () => void
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

  const filtered = notes
    .filter(n => n.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8)

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
          onSelect(filtered[activeIndex])
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
      className="fixed z-[9999] bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian overflow-hidden min-w-[200px] max-w-[320px] max-h-72 overflow-y-auto"
      style={{ top, left: position.left }}
    >
      {filtered.map((note, i) => (
        <div
          key={note.id}
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
          <DocumentTextIcon className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{note.title}</span>
        </div>
      ))}
    </div>,
    document.body
  )
}
