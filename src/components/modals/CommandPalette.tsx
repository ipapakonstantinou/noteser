'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Fuse from 'fuse.js'
import { useUIStore } from '@/stores/uiStore'
import { getAllCommands, type Command } from '@/utils/commands'

/**
 * VS Code / Obsidian-style command palette. Mounted at the root and shown
 * when `modal.type === 'command-palette'`. Opens via Ctrl+Shift+P (see the
 * `openCommandPalette` shortcut) — the modal itself owns input focus,
 * fuzzy filtering, and keyboard navigation.
 *
 * Implementation notes:
 *   - We re-call `getAllCommands()` once on open. The list isn't huge
 *     (max ~500 notes + a couple dozen commands) so building a fresh Fuse
 *     index every open is fine.
 *   - We DO NOT reuse the `searchNotes` instance from search.ts — that one
 *     is configured for the Note shape, not Command. Spinning up a small
 *     palette-local Fuse is simpler than generalising the singleton.
 *   - When the query is empty we show every command grouped by `group`,
 *     ordered: Commands first (in registry order), then Notes.
 */

interface RowEntry {
  cmd: Command
  /** True if this row is the first of its group — we render a group header
   *  above it. Computed once per filtered result so we don't need to
   *  re-scan the list on every render. */
  showHeader: boolean
}

export const CommandPalette = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const isOpen = modal.type === 'command-palette'

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Build (or rebuild) the command list + Fuse index whenever the modal
  // opens. Cheap — see the comment at the top of the file.
  const commands = useMemo<Command[]>(
    () => (isOpen ? getAllCommands() : []),
    [isOpen],
  )

  const fuse = useMemo(() => {
    if (!isOpen) return null
    return new Fuse(commands, {
      keys: [
        { name: 'label', weight: 0.7 },
        { name: 'keywords', weight: 0.25 },
        { name: 'description', weight: 0.15 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 1,
    })
  }, [isOpen, commands])

  // Reset state every time we open
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  // Filter + sort. When the query is empty we show everything in declared
  // order so the palette is browsable. When it's not empty we let Fuse
  // rank.
  const filtered = useMemo<Command[]>(() => {
    if (!isOpen) return []
    const q = query.trim()
    if (!q) return commands
    if (!fuse) return []
    return fuse.search(q).map(r => r.item)
  }, [isOpen, query, commands, fuse])

  // When the user types we always want the first row highlighted — old
  // selection no longer makes sense against the new ordering.
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Decorate filtered rows with group-header info. For an empty query the
  // headers appear once per group; for a fuzzy search we still group but
  // Fuse may interleave commands and notes by score so headers can repeat
  // when the same group reappears after another.
  const rows = useMemo<RowEntry[]>(() => {
    const out: RowEntry[] = []
    let lastGroup: string | undefined
    for (const cmd of filtered) {
      const g = cmd.group ?? 'Commands'
      out.push({ cmd, showHeader: g !== lastGroup })
      lastGroup = g
    }
    return out
  }, [filtered])

  // Scroll the highlighted row into view on arrow nav
  useEffect(() => {
    if (!listRef.current) return
    const sel = listRef.current.querySelector<HTMLElement>(
      `[data-row-index="${selectedIndex}"]`,
    )
    sel?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const runIndex = async (idx: number) => {
    const cmd = filtered[idx]
    if (!cmd) return
    // Close first so the command's modal-opening side-effects (e.g.
    // openModal('settings')) aren't overwritten by our own close.
    closeModal()
    try {
      await cmd.run()
    } catch (err) {
      console.error('Command failed:', cmd.id, err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev =>
          prev < filtered.length - 1 ? prev + 1 : prev,
        )
        return
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0))
        return
      case 'Enter':
        e.preventDefault()
        void runIndex(selectedIndex)
        return
      case 'Escape':
        e.preventDefault()
        closeModal()
        return
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeModal}
      />

      {/* Palette container — same visual idiom as SearchModal */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-obsidianGray rounded-lg shadow-obsidian border border-obsidianBorder overflow-hidden"
        onClick={e => e.stopPropagation()}
        data-testid="command-palette"
      >
        {/* Input */}
        <div className="flex items-center px-4 py-3 border-b border-obsidianBorder">
          <span className="text-obsidianSecondaryText mr-3 select-none">{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or note title…"
            className="flex-1 bg-transparent text-obsidianText placeholder-obsidianSecondaryText focus:outline-none"
            autoComplete="off"
            data-testid="command-palette-input"
          />
          <span className="text-xs text-obsidianSecondaryText px-2 py-1 bg-obsidianDarkGray rounded">
            ESC
          </span>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-96 overflow-y-auto" data-testid="command-palette-list">
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-obsidianSecondaryText">
              {query ? `No commands found for "${query}"` : 'No commands available'}
            </div>
          )}

          {rows.map((row, index) => {
            const { cmd, showHeader } = row
            const groupLabel = cmd.group ?? 'Commands'
            return (
              <div key={cmd.id}>
                {showHeader && (
                  <div
                    className="px-4 pt-3 pb-1 text-xs uppercase tracking-wide text-obsidianSecondaryText"
                    data-testid={`command-palette-group-${groupLabel}`}
                  >
                    {groupLabel}
                  </div>
                )}
                <button
                  data-row-index={index}
                  data-testid="command-palette-row"
                  onClick={() => void runIndex(index)}
                  onMouseMove={() => setSelectedIndex(index)}
                  className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
                    index === selectedIndex
                      ? 'bg-obsidianHighlight'
                      : 'hover:bg-obsidianDarkGray'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-obsidianText truncate">{cmd.label}</div>
                    {cmd.description && (
                      <div className="text-xs text-obsidianSecondaryText truncate">
                        {cmd.description}
                      </div>
                    )}
                  </div>
                  {cmd.combo && (
                    <span className="text-xs text-obsidianSecondaryText px-2 py-1 bg-obsidianDarkGray rounded flex-shrink-0">
                      {cmd.combo}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
