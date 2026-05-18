'use client'

import {
  MagnifyingGlassIcon,
  DocumentDuplicateIcon,
  ClockIcon,
  TagIcon,
  TrashIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore } from '@/stores'

// Obsidian-style far-left ribbon. Always visible. Holds Search + nav icons
// (All Notes, Recent, Tags, Trash, Calendar). Clicking a nav icon switches
// the sidebar's content area to that view.
export const Ribbon = () => {
  const { openSearch, currentView, setCurrentView } = useUIStore()
  const { getDeletedNotes, getRecentNotes } = useNoteStore()

  const trashCount = getDeletedNotes().length
  const recentCount = getRecentNotes(99).length

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
        active={currentView === 'calendar'}
        onClick={() => setCurrentView('calendar')}
        title="Calendar"
      >
        <CalendarDaysIcon className="w-5 h-5" />
      </RibbonNavButton>
      <RibbonNavButton
        active={currentView === 'trash'}
        onClick={() => setCurrentView('trash')}
        title={`Trash${trashCount ? ` (${trashCount})` : ''}`}
      >
        <TrashIcon className="w-5 h-5" />
      </RibbonNavButton>
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
