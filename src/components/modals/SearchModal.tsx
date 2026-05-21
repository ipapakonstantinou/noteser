'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { MagnifyingGlassIcon, DocumentTextIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore, useFolderStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import { searchNotes, getMatchSnippet } from '@/utils/search'
import type { SearchResult } from '@/types'
import { useDebounce } from '@/hooks/useDebounce'
import { embedText } from '@/utils/aiClient'
import { cosineSimilarity, listAllEmbeddings } from '@/utils/embeddings'

type SearchMode = 'fuzzy' | 'semantic'

export const SearchModal = () => {
  const { isSearchOpen, closeSearch, searchQuery, setSearchQuery } = useUIStore()
  const { notes, getActiveNotes } = useNoteStore()
  const openNote = useWorkspaceStore(s => s.openNote)
  const { getFolderById } = useFolderStore()
  const aiEmbeddingsEnabled = useSettingsStore(s => s.aiEmbeddingsEnabled)
  const aiProvider = useSettingsStore(s => s.aiProvider)
  const aiApiKey = useSettingsStore(s => s.aiApiKey)

  // Semantic mode is only meaningful when embeddings are wired up AND
  // the user has an OpenAI key. Surface the toggle either way so users
  // discover the feature, but disable it when prerequisites aren't met.
  const semanticAvailable = aiEmbeddingsEnabled && aiProvider === 'openai' && !!aiApiKey

  const [mode, setMode] = useState<SearchMode>('fuzzy')
  const [semanticResults, setSemanticResults] = useState<SearchResult[]>([])
  const [semanticError, setSemanticError] = useState<string | null>(null)
  const [semanticPending, setSemanticPending] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Fuzzy mode uses a 150ms debounce; semantic uses 400ms because every
  // query string change hits the OpenAI API. Both share the same input.
  const fuzzyDebounced = useDebounce(searchQuery, 150)
  const semanticDebounced = useDebounce(searchQuery, 400)

  // `notes` is the trigger; getActiveNotes pulls fresh state internally so it
  // doesn't need to be in the deps array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeNotes = useMemo(() => getActiveNotes(), [notes])

  const fuzzyResults = useMemo(() => {
    if (!fuzzyDebounced.trim()) return []
    return searchNotes(activeNotes, fuzzyDebounced).slice(0, 10)
  }, [activeNotes, fuzzyDebounced])

  // Run semantic search when in semantic mode + debounced query changes.
  // Each call: embed the query, cosine-rank against every cached note
  // embedding, surface the top 10. Falls back to fuzzy results when
  // the embed call fails (network / quota).
  useEffect(() => {
    if (mode !== 'semantic' || !semanticAvailable) {
      setSemanticResults([])
      setSemanticError(null)
      setSemanticPending(false)
      return
    }
    const query = semanticDebounced.trim()
    if (!query) {
      setSemanticResults([])
      setSemanticError(null)
      setSemanticPending(false)
      return
    }
    let cancelled = false
    setSemanticPending(true)
    setSemanticError(null)
    ;(async () => {
      try {
        const [queryVec, cached] = await Promise.all([
          embedText({ text: query }),
          listAllEmbeddings(),
        ])
        if (cancelled) return
        if (queryVec.length === 0 || cached.length === 0) {
          setSemanticResults([])
          if (cached.length === 0) {
            setSemanticError('No notes are indexed yet. Run Settings → AI → Index all notes.')
          }
          return
        }
        const ids = new Set(activeNotes.map(n => n.id))
        const ranked = cached
          .filter(c => ids.has(c.noteId))
          .map(c => ({ noteId: c.noteId, score: cosineSimilarity(queryVec, c.vector) }))
          .filter(r => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
        const byId = new Map(activeNotes.map(n => [n.id, n]))
        const results: SearchResult[] = ranked.map(r => {
          const n = byId.get(r.noteId)
          return {
            noteId: r.noteId,
            title: n?.title ?? 'Untitled',
            content: n?.content ?? '',
            matches: [],
            score: r.score,
          }
        })
        setSemanticResults(results)
      } catch (err) {
        if (cancelled) return
        setSemanticError(err instanceof Error ? err.message : 'Semantic search failed.')
        setSemanticResults([])
      } finally {
        if (!cancelled) setSemanticPending(false)
      }
    })()
    return () => { cancelled = true }
  }, [mode, semanticDebounced, semanticAvailable, activeNotes])

  const results = mode === 'semantic' ? semanticResults : fuzzyResults

  // Focus input when modal opens
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 0)
      setSelectedIndex(0)
    }
  }, [isSearchOpen])

  // Reset selection when switching modes so the user doesn't end up
  // with a stale index pointing past the end of the new results list.
  useEffect(() => { setSelectedIndex(0) }, [mode])

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
    openNote(noteId)
    closeSearch()
  }

  if (!isSearchOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20dvh]">
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
            placeholder={mode === 'semantic' ? 'Describe what you’re looking for…' : 'Search notes…'}
            className="flex-1 bg-transparent text-obsidianText placeholder-obsidianSecondaryText focus:outline-none"
            autoComplete="off"
            data-testid="search-input"
          />
          <span className="text-xs text-obsidianSecondaryText px-2 py-1 bg-obsidianDarkGray rounded">
            ESC
          </span>
        </div>

        {/* Mode toggle — fuzzy vs semantic. Semantic is disabled with
            a hint when the embeddings prerequisites aren't met so the
            user discovers what's needed to enable it. */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-obsidianBorder bg-obsidianDarkGray/30 text-xs">
          <button
            type="button"
            onClick={() => setMode('fuzzy')}
            className={`px-2 py-0.5 rounded transition-colors ${
              mode === 'fuzzy'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:text-obsidianText'
            }`}
            data-testid="search-mode-fuzzy"
          >
            Fuzzy
          </button>
          <button
            type="button"
            onClick={() => semanticAvailable && setMode('semantic')}
            disabled={!semanticAvailable}
            title={semanticAvailable ? 'Semantic search via OpenAI embeddings' : 'Enable AI embeddings in Settings → AI to use semantic search'}
            className={`px-2 py-0.5 rounded inline-flex items-center gap-1 transition-colors ${
              mode === 'semantic'
                ? 'bg-obsidianAccentPurple text-white'
                : semanticAvailable
                  ? 'text-obsidianSecondaryText hover:text-obsidianText'
                  : 'text-obsidianSecondaryText/40 cursor-not-allowed'
            }`}
            data-testid="search-mode-semantic"
          >
            <SparklesIcon className="w-3 h-3" />
            Semantic
          </button>
          {mode === 'semantic' && semanticPending && (
            <span className="ml-auto text-obsidianSecondaryText">searching…</span>
          )}
          {mode === 'semantic' && !semanticPending && semanticError && (
            <span className="ml-auto text-red-400 truncate" title={semanticError}>{semanticError}</span>
          )}
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
                    {mode === 'semantic'
                      ? (result.content.trim().slice(0, 120) || '(empty note)')
                      : getMatchSnippet(result.content, result.matches)}
                  </p>
                  {mode === 'semantic' && (
                    <span className="text-[10px] text-obsidianSecondaryText/60 font-mono">
                      {(result.score * 100).toFixed(0)}% match
                    </span>
                  )}
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
