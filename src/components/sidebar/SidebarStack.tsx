'use client'

import {
  CalendarDaysIcon,
  ListBulletIcon,
  DocumentDuplicateIcon,
  MagnifyingGlassIcon,
  BookmarkIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, type SidebarTabId } from '@/stores'
import { FolderTree } from './FolderTree'
import { FolderTreeToolbar } from './FolderTreeToolbar'
import { CalendarView } from './CalendarView'
import { OutlineView } from './OutlineView'
import { GitHubView } from './GitHubView'
import { SidebarSection } from './SidebarSection'
import { SidebarSearchPanel } from './SidebarSearchPanel'
import { SidebarBookmarksPanel } from './SidebarBookmarksPanel'

interface Props {
  onRightClick: (e: React.MouseEvent, type: 'note' | 'folder', id: string) => void
}

// Stacked sidebar (s4r3 v2 — Obsidian model). Top: pinned Calendar
// (collapsible + resizable). Middle: tab strip with five tabs. Bottom:
// the active tab's panel content (flex-fills remaining space).
//
// The Calendar section uses the same SidebarSection shell as v1, but
// it's the ONLY section now — the other former sections moved into the
// tab switcher below.
export const SidebarStack = ({ onRightClick }: Props) => {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Pinned Calendar */}
      <SidebarSection
        id="calendar"
        title="Calendar"
        icon={<CalendarDaysIcon className="w-3.5 h-3.5" />}
      >
        <CalendarView />
      </SidebarSection>

      {/* Tab strip + active panel */}
      <TabSwitcher onRightClick={onRightClick} />
    </div>
  )
}

// Compact icon strip + active panel below. Active tab's background
// matches the obsidian-git/Obsidian look: subtle highlight + slightly
// stronger text. Inactive tabs use the same hover style as the ribbon.
const TabSwitcher = ({ onRightClick }: { onRightClick: Props['onRightClick'] }) => {
  const tabId = useUIStore(s => s.sidebarTabId)
  const setTab = useUIStore(s => s.setSidebarTab)

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-obsidianBorder">
      <div className="flex items-center gap-0.5 px-1 py-1 border-b border-obsidianBorder bg-obsidianDarkGray/40">
        <TabButton id="files"          active={tabId === 'files'}          onClick={() => setTab('files')}          title="Files">
          <DocumentDuplicateIcon className="w-4 h-4" />
        </TabButton>
        <TabButton id="outline"        active={tabId === 'outline'}        onClick={() => setTab('outline')}        title="Outline">
          <ListBulletIcon className="w-4 h-4" />
        </TabButton>
        <TabButton id="source-control" active={tabId === 'source-control'} onClick={() => setTab('source-control')} title="Source control">
          <CodeBracketIcon className="w-4 h-4" />
        </TabButton>
        <TabButton id="search"         active={tabId === 'search'}         onClick={() => setTab('search')}         title="Search">
          <MagnifyingGlassIcon className="w-4 h-4" />
        </TabButton>
        <TabButton id="bookmarks"      active={tabId === 'bookmarks'}      onClick={() => setTab('bookmarks')}      title="Bookmarks">
          <BookmarkIcon className="w-4 h-4" />
        </TabButton>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tabId === 'files' && (
          <div className="flex flex-col h-full">
            <FolderTreeToolbar />
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              <FolderTree onRightClick={onRightClick} />
            </div>
          </div>
        )}
        {tabId === 'outline'        && <OutlineView />}
        {tabId === 'source-control' && <GitHubView />}
        {tabId === 'search'         && <SidebarSearchPanel />}
        {tabId === 'bookmarks'      && <SidebarBookmarksPanel />}
      </div>
    </div>
  )
}

const TabButton = ({
  id, active, onClick, title, children,
}: {
  id: SidebarTabId
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={title}
    aria-pressed={active}
    data-testid={`sidebar-tab-${id}`}
    className={`flex-1 flex items-center justify-center py-1.5 rounded transition-colors ${
      active
        ? 'bg-obsidianHighlight text-obsidianText'
        : 'text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText'
    }`}
  >
    {children}
  </button>
)

export default SidebarStack
