'use client'

import {
  CalendarDaysIcon,
  ListBulletIcon,
  LinkIcon,
  CloudArrowUpIcon,
} from '@heroicons/react/24/outline'
import { FolderTree } from './FolderTree'
import { FolderTreeToolbar } from './FolderTreeToolbar'
import { CalendarView } from './CalendarView'
import { OutlineView } from './OutlineView'
import { BacklinksView } from './BacklinksView'
import { GitHubView } from './GitHubView'
import { SidebarSection } from './SidebarSection'

interface Props {
  onRightClick: (e: React.MouseEvent, type: 'note' | 'folder', id: string) => void
}

// Obsidian-style stacked sidebar (s4r3). The Files tree gets the top
// slot with flex: 1 — it always absorbs whatever vertical space the
// collapsible mini-panels below leave behind. The mini-panels
// (Calendar / Outline / Backlinks / Source Control) are user-collapsible
// and individually resizable, with state persisted in useUIStore.
//
// FilesTree continues to read currentView from useUIStore for filter
// modes (Recent / Tags / Trash / Templates) — ribbon clicks on those
// icons still call setCurrentView. Ribbon clicks on Calendar / Outline /
// Backlinks / Source Control now expand the matching SECTION instead of
// swapping the entire sidebar view (see Ribbon.tsx).
//
// Bookmarks is deliberately omitted from this v1 — no underlying view
// exists yet; tracked as a future follow-up.
export const SidebarStack = ({ onRightClick }: Props) => {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Files tree — flex-fill, no collapse */}
      <div className="flex-1 min-h-0 flex flex-col">
        <FolderTreeToolbar />
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          <FolderTree onRightClick={onRightClick} />
        </div>
      </div>

      {/* Mini-panels — fixed-but-resizable, collapsible */}
      <SidebarSection
        id="calendar"
        title="Calendar"
        icon={<CalendarDaysIcon className="w-3.5 h-3.5" />}
      >
        <CalendarView />
      </SidebarSection>

      <SidebarSection
        id="outline"
        title="Outline"
        icon={<ListBulletIcon className="w-3.5 h-3.5" />}
      >
        <OutlineView />
      </SidebarSection>

      <SidebarSection
        id="backlinks"
        title="Backlinks"
        icon={<LinkIcon className="w-3.5 h-3.5" />}
      >
        <BacklinksView />
      </SidebarSection>

      <SidebarSection
        id="source-control"
        title="Source Control"
        icon={<CloudArrowUpIcon className="w-3.5 h-3.5" />}
      >
        <GitHubView />
      </SidebarSection>
    </div>
  )
}

export default SidebarStack
