'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { MagnifyingGlassIcon, DocumentTextIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore, useFolderStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import { searchNotes, getMatchSnippet } from '@/utils/search'
import type { SearchResult } from '@/types'
import { useDebounce } from '@/hooks/useDebounce'
import { embedText } from '@/utils/aiClient'
import { cosineSimilarity, listAllEmbeddings } from '@/utils/embeddings'

type SearchMode = 'fuzzy' | 'semantic'

export const SearchModal = () => {
  const isSearchOpen = useUIStore(s => s.isSearchOpen)
  const closeSearch = useUIStore(s => s.closeSearch)
  const searchQuery = useUIStore(s => s.searchQuery)
  const setSearchQuery = useUIStore(s => s.setSearchQuery)
  const notes = useNoteStore(s => s.notes)
  const getActiveNotes = useNoteStore(s => s.getActiveNotes)
  const openNote = useWorkspaceStore(s => s.openNote)
  const recentIds = useWorkspaceStore(s => s.recents)
  const getFolderById = useFolderStore(s => s.getFolderById)
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

  // Clear semantic state WITHOUT scheduling a re-render when it's already
  // clear. Functional updaters that return the same reference are a no-op in
  // React, so this can run on every effect pass (the effect re-fires whenever
  // `activeNotes` changes) without feeding an update loop. A plain
  // setSemanticResults([]) allocates a fresh array each call, which React
  // treats as a change — during a large note influx that cascade tripped
  // "Maximum update depth exceeded".
  const resetSemanticState = useCallback(() => {
    setSemanticResults(prev => (prev.length ? [] : prev))
    setSemanticError(prev => (prev === null ? prev : null))
    setSemanticPending(prev => (prev ? false : prev))
  }, [])

  // Run semantic search when in semantic mode + debounced query changes.
  // Each call: embed the query, cosine-rank against every cached note
  // embedding, surface the top 10. Falls back to fuzzy results when
  // the embed call fails (network / quota).
  useEffect(() => {
    if (mode !== 'semantic' || !semanticAvailable) {
      resetSemanticState()
      return
    }
    const query = semanticDebounced.trim()
    if (!query) {
      resetSemanticState()
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
  }, [mode, semanticDebounced, semanticAvailable, activeNotes, resetSemanticState])

  // Recent notes shown when the query box is empty (Obsidian quick-switcher /
  // VS Code Ctrl+P style). Resolve the MRU note-id list against the ACTIVE
  // notes so trashed/deleted notes never surface, preserving most-recent-first
  // order. `notes` is the trigger; activeNotes is already memoised on it.
  const recentResults = useMemo<SearchResult[]>(() => {
    const byId = new Map(activeNotes.map(n => [n.id, n]))
    const out: SearchResult[] = []
    for (const id of recentIds) {
      const n = byId.get(id)
      if (!n) continue
      out.push({ noteId: n.id, title: n.title, content: n.content, matches: [], score: 0 })
    }
    return out
  }, [recentIds, activeNotes])

  // With an empty query we show recents; once the user types we hand over to
  // the fuzzy / semantic results. Keyboard nav + selection operate on the
  // SAME `results` array either way.
  const showingRecents = !searchQuery.trim()
  const searchResults = mode === 'semantic' ? semanticResults : fuzzyResults
  const results = showingRecents ? recentResults : searchResults

  // Focus input when modal opens
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 0)
      setSelectedIndex(0)
    }
  }, [isSearchOpen])

  // Reset selection when switching modes, or when crossing the
  // recents↔search boundary (typing the first char / clearing back to
  // empty), so the index never points past the end of the new list.
  useEffect(() => { setSelectedIndex(0) }, [mode, showingRecents])

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
        className="absolute inset-0 bg-black/60 backdrop-blur-xs"
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
            className="flex-1 bg-transparent text-obsidianText placeholder-obsidianSecondaryText focus:outline-hidden"
            autoComplete="off"
            data-testid="search-input"
          />
          <span className="text-xs text-obsidianSecondaryText px-2 py-1 bg-obsidianDarkGray rounded-sm">
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
          {!showingRecents && results.length === 0 && (
            <div className="px-4 py-8 text-center text-obsidianSecondaryText">
              No notes found for &quot;{searchQuery}&quot;
            </div>
          )}

          {showingRecents && results.length > 0 && (
            <div
              className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-obsidianSecondaryText"
              data-testid="search-recent-header"
            >
              Recent
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
                <DocumentTextIcon className="w-5 h-5 text-obsidianSecondaryText shrink-0 mt-0.5" />
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
                  {!showingRecents && (
                    <p className="text-sm text-obsidianSecondaryText truncate mt-1">
                      {mode === 'semantic'
                        ? (result.content.trim().slice(0, 120) || '(empty note)')
                        : getMatchSnippet(result.content, result.matches)}
                    </p>
                  )}
                  {mode === 'semantic' && (
                    <span className="text-[10px] text-obsidianSecondaryText/60 font-mono">
                      {(result.score * 100).toFixed(0)}% match
                    </span>
                  )}
                </div>
              </button>
            )
          })}

          {showingRecents && results.length === 0 && (
            <div className="px-4 py-8 text-center text-obsidianSecondaryText" data-testid="search-recent-empty">
              <p>No recent notes yet</p>
              <p className="text-xs mt-2">
                Type to search your notes. Use{' '}
                <kbd className="px-1 py-0.5 bg-obsidianDarkGray rounded-sm text-xs">↑</kbd>{' '}
                <kbd className="px-1 py-0.5 bg-obsidianDarkGray rounded-sm text-xs">↓</kbd> to navigate,{' '}
                <kbd className="px-1 py-0.5 bg-obsidianDarkGray rounded-sm text-xs">Enter</kbd> to select
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchModal
