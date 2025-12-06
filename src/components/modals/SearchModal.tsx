'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { MagnifyingGlassIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore, useFolderStore } from '@/stores'
import { searchNotes, getMatchSnippet } from '@/utils/search'
import { useDebounce } from '@/hooks/useDebounce'

export const SearchModal = () => {
  const { isSearchOpen, closeSearch, searchQuery, setSearchQuery } = useUIStore()
  const { notes, selectNote, getActiveNotes } = useNoteStore()
  const { getFolderById } = useFolderStore()

  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const debouncedQuery = useDebounce(searchQuery, 150)

  const activeNotes = useMemo(() => getActiveNotes(), [notes])

  const results = useMemo(() => {
    if (!debouncedQuery.trim()) return []
    return searchNotes(activeNotes, debouncedQuery).slice(0, 10)
  }, [activeNotes, debouncedQuery])

  // Focus input when modal opens
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 0)
      setSelectedIndex(0)
    }
  }, [isSearchOpen])

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev =>
          prev < results.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0))
        break
      case 'Enter':
        e.preventDefault()
        if (results[selectedIndex]) {
          handleSelectNote(results[selectedIndex].noteId)
        }
        break
      case 'Escape':
        closeSearch()
        break
    }
  }

  // Scroll selected item into view
  useEffect(() => {
    const selected = resultsRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleSelectNote = (noteId: string) => {
    selectNote(noteId)
    closeSearch()
  }

  if (!isSearchOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeSearch}
      />

      {/* Search container */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-obsidianGray rounded-lg shadow-obsidian border border-obsidianBorder overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 py-3 border-b border-obsidianBorder">
          <MagnifyingGlassIcon className="w-5 h-5 text-obsidianSecondaryText mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes..."
            className="flex-1 bg-transparent text-obsidianText placeholder-obsidianSecondaryText focus:outline-none"
            autoComplete="off"
          />
          <span className="text-xs text-obsidianSecondaryText px-2 py-1 bg-obsidianDarkGray rounded">
            ESC
          </span>
        </div>

        {/* Results */}
        <div
          ref={resultsRef}
          className="max-h-96 overflow-y-auto"
        >
          {searchQuery && results.length === 0 && (
            <div className="px-4 py-8 text-center text-obsidianSecondaryText">
              No notes found for &quot;{searchQuery}&quot;
            </div>
          )}

          {results.map((result, index) => {
            const folder = result.noteId
              ? getFolderById(activeNotes.find(n => n.id === result.noteId)?.folderId || '')
              : null

            return (
              <button
                key={result.noteId}
                data-index={index}
                onClick={() => handleSelectNote(result.noteId)}
                className={`w-full px-4 py-3 text-left flex items-start gap-3 transition-colors ${
                  index === selectedIndex
                    ? 'bg-obsidianHighlight'
                    : 'hover:bg-obsidianDarkGray'
                }`}
              >
                <DocumentTextIcon className="w-5 h-5 text-obsidianSecondaryText flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-obsidianText truncate">
                      {result.title}
                    </span>
                    {folder && (
                      <span className="text-xs text-obsidianSecondaryText">
                        in {folder.name}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-obsidianSecondaryText truncate mt-1">
                    {getMatchSnippet(result.content, result.matches)}
                  </p>
                </div>
              </button>
            )
          })}

          {!searchQuery && (
            <div className="px-4 py-8 text-center text-obsidianSecondaryText">
              <p>Type to search your notes</p>
              <p className="text-xs mt-2">
                Use <kbd className="px-1 py-0.5 bg-obsidianDarkGray rounded text-xs">↑</kbd>{' '}
                <kbd className="px-1 py-0.5 bg-obsidianDarkGray rounded text-xs">↓</kbd> to navigate,{' '}
                <kbd className="px-1 py-0.5 bg-obsidianDarkGray rounded text-xs">Enter</kbd> to select
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchModal
