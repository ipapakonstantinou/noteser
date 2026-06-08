'use client'

import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react'
import {
  CogIcon,
  PencilSquareIcon,
  CalendarDaysIcon,
  PaperClipIcon,
  DocumentDuplicateIcon,
  CloudIcon,
  SparklesIcon,
  CommandLineIcon,
  ArrowDownTrayIcon,
  InformationCircleIcon,
  BeakerIcon,
  PuzzlePieceIcon,
  SwatchIcon,
  ViewColumnsIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useSettingsStore } from '@/stores'
import { Modal } from '@/components/ui'
import { AttachmentsSection } from './AttachmentsSection'
import { AISection } from './AISection'
import { DailyNotesSection, TemplatesSection } from './DailyNotesSection'
import { ExportSection } from './ExportSection'
import { ShortcutsSection } from './ShortcutsSection'
import { SettingsFooter } from './settings'
import { PluginsSettingsPanel } from './PluginsSettingsPanel'
import { SETTINGS_CATALOG, type SettingsCatalogEntry } from './settings/settingsCatalog'
import { filterSettingsCatalog, groupByCategory } from './settings/filterSettingsCatalog'
import {
  GeneralPanel,
  AppearancePanel,
  EditorPanel,
  SidebarPanel,
  LocalFolderPanel,
  GitHubPanel,
  BetaPanel,
  AboutPanel,
} from './settings/panels'

// One row in the left-side category navigator. Order here drives the
// rendering order of the list AND the keyboard up/down nav (later).
type CategoryId =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'sidebar'
  | 'attachments'
  | 'daily-notes'
  | 'templates'
  | 'github'
  | 'local-folder'
  | 'ai'
  | 'shortcuts'
  | 'export'
  | 'plugins'
  | 'beta'
  | 'about'

interface CategoryDef {
  id: CategoryId
  label: string
  // Lucide-style icons from heroicons; sized 18px inline.
  Icon: typeof CogIcon
}

const CATEGORIES: readonly CategoryDef[] = [
  { id: 'general',     label: 'General',     Icon: CogIcon },
  { id: 'appearance',  label: 'Appearance',  Icon: SwatchIcon },
  { id: 'editor',      label: 'Editor',      Icon: PencilSquareIcon },
  { id: 'sidebar',     label: 'Sidebar',     Icon: ViewColumnsIcon },
  { id: 'attachments', label: 'Attachments', Icon: PaperClipIcon },
  { id: 'daily-notes', label: 'Daily & weekly notes', Icon: CalendarDaysIcon },
  { id: 'templates',   label: 'Templates',   Icon: DocumentDuplicateIcon },
  { id: 'github',      label: 'GitHub sync', Icon: CloudIcon },
  { id: 'local-folder', label: 'Local folder', Icon: FolderOpenIcon },
  { id: 'ai',          label: 'AI',          Icon: SparklesIcon },
  { id: 'shortcuts',   label: 'Shortcuts',   Icon: CommandLineIcon },
  { id: 'export',      label: 'Export',      Icon: ArrowDownTrayIcon },
  { id: 'plugins',     label: 'Plugins',     Icon: PuzzlePieceIcon },
  { id: 'beta',        label: 'Beta',        Icon: BeakerIcon },
  { id: 'about',       label: 'About',       Icon: InformationCircleIcon },
]

export const SettingsModal = () => {
  const modal = useUIStore(s => s.modal)
  const closeModal = useUIStore(s => s.closeModal)
  const isOpen = modal.type === 'settings'

  // Remembers the active category for the lifetime of the modal. Reset
  // when the modal re-opens via `key={modal.type}` on the inner panel —
  // not strictly necessary but it keeps the default predictable.
  const [active, setActive] = useState<CategoryId>('general')
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Reset state every time the modal opens fresh.
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActive('general')
    }
  }, [isOpen])

  // Auto-focus the search input when the modal opens, and listen for `/`
  // to refocus from elsewhere in the modal. Esc while the search has a
  // query clears it; Modal's own Esc handler then closes the modal on
  // the next press (because we stop propagation only when there is a
  // query to clear).
  useEffect(() => {
    if (!isOpen) return
    // Defer focus one frame so the input is mounted.
    const id = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      // `/` from anywhere in the modal refocuses the search input, as
      // long as the user is not already typing into another text field
      // where `/` is a real character.
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName
        const editable = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable
        if (!editable || target === searchInputRef.current) {
          e.preventDefault()
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen])

  // Capture-phase Escape interceptor: if the search has a query, swallow
  // the first Escape so Modal's own listener does not close the modal.
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (query.length === 0) return
      const focused = document.activeElement
      if (focused !== searchInputRef.current) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setQuery('')
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [isOpen, query])

  const trimmedQuery = query.trim()
  const isSearching = trimmedQuery.length > 0
  const searchResults = useMemo(
    () => (isSearching ? filterSettingsCatalog(SETTINGS_CATALOG, trimmedQuery) : []),
    [isSearching, trimmedQuery],
  )

  const handleJumpToCategory = (categoryId: CategoryId) => {
    setActive(categoryId)
    setQuery('')
    searchInputRef.current?.blur()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title="Settings"
      size="3xl"
      bodyless
    >
      <div className="flex flex-col h-[80dvh] md:h-[70dvh] min-h-[480px]">
        {/* Sticky search row spanning sidebar + main column. */}
        <div className="flex-none border-b border-obsidianBorder px-3 py-2 bg-obsidianBlack/40">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-obsidianSecondaryText pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              data-testid="settings-search-input"
              className="w-full pl-8 pr-8 py-1.5 text-sm bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  searchInputRef.current?.focus()
                }}
                aria-label="Clear search"
                data-testid="settings-search-clear"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-obsidianSecondaryText hover:text-obsidianText hover:bg-obsidianHighlight"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          {/* ── Mobile (≤md): horizontal scroll strip of category chips
                  across the top. Desktop: vertical left rail.
              Hidden while a search query is active — the results list
              owns the whole right pane and category context is shown
              per-result. */}
          {!isSearching && (
            <nav
              aria-label="Settings categories"
              className="md:w-52 md:flex-none md:border-r border-b md:border-b-0 border-obsidianBorder bg-obsidianBlack/40 overflow-x-auto md:overflow-x-visible md:overflow-y-auto py-1 md:py-2 flex md:block flex-row gap-1 md:gap-0 px-2 md:px-0 flex-none"
              data-testid="settings-categories"
            >
              {CATEGORIES.map(cat => {
                const isActive = cat.id === active
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActive(cat.id)}
                    aria-current={isActive ? 'page' : undefined}
                    data-testid={`settings-cat-${cat.id}`}
                    className={[
                      // Mobile: rounded chip; desktop: full-width row.
                      'flex items-center gap-2 text-sm text-left transition-colors flex-none',
                      'px-3 py-1.5 rounded md:rounded-none md:w-full md:px-3 md:py-1.5',
                      isActive
                        ? 'bg-obsidianAccentPurple/15 text-obsidianText md:border-l-2 md:border-obsidianAccentPurple md:pl-[10px]'
                        : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText md:border-l-2 md:border-transparent md:pl-[10px]',
                    ].join(' ')}
                  >
                    <cat.Icon className="w-4 h-4 flex-none" />
                    <span className="truncate">{cat.label}</span>
                  </button>
                )
              })}
            </nav>
          )}

          {/* ── Right pane: selected category content OR search results ── */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div
              className="flex-1 min-h-0 overflow-y-auto p-4 md:p-5"
              data-testid={isSearching ? 'settings-search-results' : `settings-panel-${active}`}
            >
              {isSearching ? (
                <SettingsSearchResults
                  query={trimmedQuery}
                  results={searchResults}
                  onJump={handleJumpToCategory}
                />
              ) : (
                <CategoryPanel id={active} />
              )}
            </div>
            <SettingsFooterBar />
          </div>
        </div>
      </div>
    </Modal>
  )
}

// Renders the filtered settings list grouped by category. The Go to setting
// button jumps to that setting's category and clears the query so the user
// lands on the live control.
function SettingsSearchResults({
  query,
  results,
  onJump,
}: {
  query: string
  results: SettingsCatalogEntry[]
  onJump: (categoryId: CategoryId) => void
}) {
  if (results.length === 0) {
    return (
      <div className="text-sm text-obsidianSecondaryText" data-testid="settings-search-empty">
        No settings match &ldquo;{query}&rdquo;.
      </div>
    )
  }
  const groups = groupByCategory(results)
  return (
    <div className="space-y-5" data-testid="settings-search-list">
      {groups.map(group => (
        <div key={group.categoryId} className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
            {group.categoryLabel}
          </div>
          <ul className="divide-y divide-obsidianBorder border border-obsidianBorder rounded">
            {group.items.map(item => (
              <li
                key={item.id}
                className="p-3 flex items-start justify-between gap-3"
                data-testid={`settings-search-result-${item.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-obsidianText">{item.label}</div>
                  <div className="text-xs text-obsidianSecondaryText mt-0.5">
                    {item.description}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onJump(item.categoryId as CategoryId)}
                  className="flex-none px-2 py-1 text-xs rounded border border-obsidianBorder text-obsidianText hover:border-obsidianAccentPurple hover:bg-obsidianHighlight/40 transition-colors"
                >
                  Go to setting
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// Renders the body for a given category. Split out so each branch can
// scope its own store subscriptions — the modal shell stays tiny and
// re-renders only on category switch, not on every settings change.
function CategoryPanel({ id }: { id: CategoryId }): ReactNode {
  switch (id) {
    case 'general':     return <GeneralPanel />
    case 'appearance':  return <AppearancePanel />
    case 'editor':      return <EditorPanel />
    case 'sidebar':     return <SidebarPanel />
    case 'attachments': return <AttachmentsSection />
    case 'daily-notes': return <DailyNotesSection />
    case 'templates':   return <TemplatesSection />
    case 'github':      return <GitHubPanel />
    case 'local-folder': return <LocalFolderPanel />
    case 'ai':          return <AISection />
    case 'shortcuts':   return <ShortcutsSection />
    case 'export':      return <ExportSection />
    case 'plugins':     return <PluginsSettingsPanel />
    case 'beta':        return <BetaPanel />
    case 'about':       return <AboutPanel />
  }
}

// Footer pinned to the bottom of the right pane. Memoised so changes to
// individual store fields don't churn it.
function SettingsFooterBar() {
  const closeModal = useUIStore(s => s.closeModal)
  const reset = useSettingsStore(s => s.reset)
  const footer = useMemo(() => (
    <div className="flex-none border-t border-obsidianBorder p-3">
      <SettingsFooter
        onReset={reset}
        onApply={() => {
          ;(document.activeElement as HTMLElement | null)?.blur?.()
        }}
      />
    </div>
  ), [reset, closeModal])
  return footer
}

export default SettingsModal
