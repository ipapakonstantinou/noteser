'use client'

import {
  MagnifyingGlassIcon,
  DocumentDuplicateIcon,
  ClockIcon,
  TagIcon,
  TrashIcon,
  CalendarDaysIcon,
  CloudArrowUpIcon,
  Cog6ToothIcon,
  ListBulletIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore, useGitHubStore, useWorkspaceStore } from '@/stores'
import { useHydration } from '@/hooks'

// Obsidian-style far-left ribbon. Always visible. Holds Search + nav icons
// (All Notes, Recent, Tags, Trash, Calendar) plus a Settings gear pinned
// to the bottom. Clicking a nav icon switches the sidebar's content area
// to that view.
export const Ribbon = () => {
  const { openSearch, currentView, setCurrentView, openModal } = useUIStore()
  const { getDeletedNotes, getRecentNotes } = useNoteStore()
  const hydrated = useHydration()

  // Counts come from the persisted noteStore which is only populated on the
  // client. Suppress them on the server pass so the SSR'd title attribute
  // matches the first client render — once hydrated, the badge shows.
  const trashCount = hydrated ? getDeletedNotes().length : 0
  const recentCount = hydrated ? getRecentNotes(99).length : 0
  // GitHub conflict count drives the badge on the GitHub nav icon. Same
  // hydration dance: the workspace store is persisted, so SSR sees zero.
  const conflictCount = useWorkspaceStore(s => {
    if (!hydrated) return 0
    let n = 0
    for (const pane of s.panes) for (const t of pane.tabs) if (t.kind === 'merge-conflict') n++
    return n
  })
  const githubConnected = useGitHubStore(s => hydrated && !!s.token)

  return (
    <div className="h-full w-[44px] flex flex-col items-center gap-1 py-2 bg-obsidianBlack border-r border-obsidianBorder">
      <RibbonButton onClick={openSearch} title="Search (Ctrl+K)">
        <MagnifyingGlassIcon className="w-5 h-5" />
      </RibbonButton>
      <RibbonNavButton
        active={currentView === 'notes'}
        onClick={() => setCurrentView('notes')}
        title="All notes"
      >
        <DocumentDuplicateIcon className="w-5 h-5" />
      </RibbonNavButton>
      <RibbonNavButton
        active={currentView === 'recent'}
        onClick={() => setCurrentView('recent')}
        title={`Recent${recentCount ? ` (${recentCount})` : ''}`}
      >
        <ClockIcon className="w-5 h-5" />
      </RibbonNavButton>
      <RibbonNavButton
        active={currentView === 'tags'}
        onClick={() => setCurrentView('tags')}
        title="Tags"
      >
        <TagIcon className="w-5 h-5" />
      </RibbonNavButton>
      <RibbonNavButton
        active={currentView === 'backlinks'}
        onClick={() => setCurrentView('backlinks')}
        title="Backlinks"
      >
        <LinkIcon className="w-5 h-5" />
      </RibbonNavButton>
      <RibbonNavButton
        active={currentView === 'calendar'}
        onClick={() => setCurrentView('calendar')}
        title="Calendar"
      >
        <CalendarDaysIcon className="w-5 h-5" />
      </RibbonNavButton>
      <RibbonNavButton
        active={currentView === 'outline'}
        onClick={() => setCurrentView('outline')}
        title="Outline"
      >
        <ListBulletIcon className="w-5 h-5" />
      </RibbonNavButton>
      <RibbonNavButton
        active={currentView === 'trash'}
        onClick={() => setCurrentView('trash')}
        title={`Trash${trashCount ? ` (${trashCount})` : ''}`}
      >
        <TrashIcon className="w-5 h-5" />
      </RibbonNavButton>
      {/* GitHub — shown only after the user has connected. The badge
          mirrors any pending merge-conflict tabs. */}
      {githubConnected && (
        <RibbonNavButton
          active={currentView === 'github'}
          onClick={() => setCurrentView('github')}
          title={`GitHub${conflictCount ? ` — ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` : ''}`}
        >
          <div className="relative">
            <CloudArrowUpIcon className="w-5 h-5" />
            {conflictCount > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />
            )}
          </div>
        </RibbonNavButton>
      )}

      {/* Settings — pinned to the bottom of the ribbon. */}
      <div className="mt-auto">
        <RibbonButton onClick={() => openModal({ type: 'settings' })} title="Settings">
          <Cog6ToothIcon className="w-5 h-5" />
        </RibbonButton>
      </div>
    </div>
  )
}

const RibbonButton = ({
  onClick, title, children,
}: { onClick: () => void; title: string; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    title={title}
    className="p-2 rounded text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText transition-colors"
  >
    {children}
  </button>
)

const RibbonNavButton = ({
  active, onClick, title, children,
}: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    title={title}
    className={`p-2 rounded transition-colors ${
      active
        ? 'bg-obsidianHighlight text-obsidianText'
        : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText'
    }`}
  >
    {children}
  </button>
)

export default Ribbon
