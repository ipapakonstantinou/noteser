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
} from '@heroicons/react/24/outline'
import { type SidebarTabId } from '@/stores'
import { FolderTree } from './FolderTree'
import { FolderTreeToolbar } from './FolderTreeToolbar'
import { CalendarView } from './CalendarView'
import { OutlineView } from './OutlineView'
import { GitHubView } from './GitHubView'
import { SidebarSearchPanel } from './SidebarSearchPanel'
import { SidebarBookmarksPanel } from './SidebarBookmarksPanel'
import { SidebarRelatedPanel } from './SidebarRelatedPanel'

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

// Pure: merge the saved tab order with the source order, filtering
// out anything in `pinned` so the main bottom strip doesn't
// duplicate the per-pinned mini-strips above. Each pinned panel
// gets its OWN tab strip at the top of the sidebar (Obsidian pane
// model), so seeing the same icon down here too would be noise.
// Exported for the unit test.
export function resolveTabOrder(saved: string[], pinned: string[] = []): SidebarTabId[] {
  const pinnedSet = new Set(pinned)
  const seen = new Set<string>()
  const out: SidebarTabId[] = []
  for (const id of saved) {
    if (KNOWN_IDS.has(id as SidebarTabId) && !seen.has(id) && !pinnedSet.has(id)) {
      seen.add(id)
      out.push(id as SidebarTabId)
    }
  }
  for (const p of PANELS) {
    if (pinnedSet.has(p.id)) continue
    if (!seen.has(p.id)) out.push(p.id)
  }
  return out
}

// Render the panel body for a given id — used by both zones so the
// pinned section and the tab strip's active content stay in sync.
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
  }
}
