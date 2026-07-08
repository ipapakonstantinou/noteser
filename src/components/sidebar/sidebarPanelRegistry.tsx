'use client'

// Single source of truth for which panels exist in the sidebar, what
// they render, and the order they appear in by default. Split out of
// SidebarStack.tsx (refactor 2026-05-20) so:
//
//   1. The shared `PANELS` data + `PanelBody` renderer don't sit at
//      the top of a 600-line component file.
//   2. The PinnedGroup / PinnedMiniStrip / TabSwitcher components can
//      be extracted into their own files in a future pass without
//      circular imports.
//   3. The drag MIME constant + the tab-order resolver have a clear
//      home — tests already import `resolveTabOrder` from
//      SidebarStack.tsx, which still re-exports it for back-compat.

import {
  CalendarDaysIcon,
  ListBulletIcon,
  DocumentDuplicateIcon,
  MagnifyingGlassIcon,
  BookmarkIcon,
  CodeBracketIcon,
  LinkIcon,
  LinkSlashIcon,
  PuzzlePieceIcon,
} from '@heroicons/react/24/outline'
import { type SidebarTabId } from '@/stores'
import dynamic from 'next/dynamic'
import { FolderTree } from './FolderTree'
import { FolderTreeToolbar } from './FolderTreeToolbar'
import { CalendarView } from './CalendarView'
import { OutlineView } from './OutlineView'
import { GitHubView } from './GitHubView'
// SidebarSearchPanel statically imports fuse.js (~30 kB gz). The sidebar is
// rendered at first paint, so importing it eagerly dragged fuse into the
// first-load bundle even though the default panel is "files", not "search".
// Load it lazily — the chunk fetches only when the user opens the Search
// panel. ssr:false keeps it out of the (client-only) server render.
const SidebarSearchPanel = dynamic(
  () => import('./SidebarSearchPanel').then(m => ({ default: m.SidebarSearchPanel })),
  { ssr: false },
)
import { SidebarBookmarksPanel } from './SidebarBookmarksPanel'
import { SidebarRelatedPanel } from './SidebarRelatedPanel'
import { PluginsPanel } from './PluginsPanel'
import { BrokenLinksView } from './BrokenLinksView'

interface PanelDef {
  id: SidebarTabId
  Icon: typeof DocumentDuplicateIcon
  title: string
}

export const PANELS: readonly PanelDef[] = [
  { id: 'calendar',       Icon: CalendarDaysIcon,      title: 'Calendar' },
  { id: 'files',          Icon: DocumentDuplicateIcon, title: 'Files' },
  { id: 'outline',        Icon: ListBulletIcon,        title: 'Outline' },
  { id: 'source-control', Icon: CodeBracketIcon,       title: 'Source control' },
  { id: 'search',         Icon: MagnifyingGlassIcon,   title: 'Search' },
  { id: 'bookmarks',      Icon: BookmarkIcon,          title: 'Bookmarks' },
  { id: 'related',        Icon: LinkIcon,              title: 'Related notes' },
  { id: 'plugins',        Icon: PuzzlePieceIcon,       title: 'Plugins' },
  { id: 'broken-links',   Icon: LinkSlashIcon,         title: 'Broken links' },
]

export const KNOWN_IDS = new Set<SidebarTabId>(PANELS.map(p => p.id))

// MIME shared by the main strip + every pinned mini-strip so drops
// across zones work without each component re-declaring the string.
export const TAB_DRAG_MIME = 'application/x-noteser-sidebar-tab'

// Type alias for the right-click handler the FolderTree expects. The
// PanelBody passes it down to the Files panel only; other panels
// ignore it, but the type stays uniform.
export type PanelRightClick = (
  e: React.MouseEvent,
  type: 'note' | 'folder',
  id: string,
) => void

// Render the panel body for a given id — used by every group's
// active-tab content area.
export const PanelBody = ({
  id, onRightClick,
}: { id: SidebarTabId; onRightClick: PanelRightClick }) => {
  switch (id) {
    case 'calendar':       return <CalendarView />
    case 'files':
      return (
        <div className="flex flex-col h-full">
          <FolderTreeToolbar />
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
            <FolderTree onRightClick={onRightClick} />
          </div>
        </div>
      )
    case 'outline':        return <OutlineView />
    case 'source-control': return <GitHubView />
    case 'search':         return <SidebarSearchPanel />
    case 'bookmarks':      return <SidebarBookmarksPanel />
    case 'related':        return <SidebarRelatedPanel />
    case 'plugins':        return <PluginsPanel />
    case 'broken-links':   return <BrokenLinksView />
  }
}
