'use client'

import { useMemo, useRef, useState } from 'react'
import {
  CalendarDaysIcon,
  ListBulletIcon,
  DocumentDuplicateIcon,
  MagnifyingGlassIcon,
  BookmarkIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useSettingsStore, type SidebarTabId } from '@/stores'
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
export const SidebarStack = ({ onRightClick }: Props) => {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SidebarSection
        id="calendar"
        title="Calendar"
        icon={<CalendarDaysIcon className="w-3.5 h-3.5" />}
      >
        <CalendarView />
      </SidebarSection>
      <TabSwitcher onRightClick={onRightClick} />
    </div>
  )
}

// ── Tab definitions + order resolver ───────────────────────────────────────
// Source order. Drag-reorder writes the user's order into
// settingsStore.sidebarTabOrder; we merge it with this list at render
// time so a future-added tab appears at the end of the user's
// customised order rather than disappearing.

interface TabDef {
  id: SidebarTabId
  Icon: typeof DocumentDuplicateIcon
  title: string
}

const TABS: readonly TabDef[] = [
  { id: 'files',          Icon: DocumentDuplicateIcon, title: 'Files' },
  { id: 'outline',        Icon: ListBulletIcon,        title: 'Outline' },
  { id: 'source-control', Icon: CodeBracketIcon,       title: 'Source control' },
  { id: 'search',         Icon: MagnifyingGlassIcon,   title: 'Search' },
  { id: 'bookmarks',      Icon: BookmarkIcon,          title: 'Bookmarks' },
]

// Pure: merge the saved order with the source order. Unknown ids
// dropped; missing ids appended at the end; duplicates de-duped.
// Exported for the unit test (same shape as resolveRibbonOrder).
export function resolveTabOrder(saved: string[]): SidebarTabId[] {
  const known = new Set(TABS.map(t => t.id))
  const seen = new Set<string>()
  const out: SidebarTabId[] = []
  for (const id of saved) {
    if (known.has(id as SidebarTabId) && !seen.has(id)) {
      seen.add(id)
      out.push(id as SidebarTabId)
    }
  }
  for (const t of TABS) {
    if (!seen.has(t.id)) out.push(t.id)
  }
  return out
}

const TAB_DRAG_MIME = 'application/x-noteser-sidebar-tab'

const TabSwitcher = ({ onRightClick }: { onRightClick: Props['onRightClick'] }) => {
  const tabId = useUIStore(s => s.sidebarTabId)
  const setTab = useUIStore(s => s.setSidebarTab)
  const savedOrder = useSettingsStore(s => s.sidebarTabOrder)
  const setSidebarTabOrder = useSettingsStore(s => s.setSidebarTabOrder)

  const orderedIds = useMemo(() => resolveTabOrder(savedOrder), [savedOrder])
  const tabsById = useMemo(() => new Map(TABS.map(t => [t.id, t])), [])

  const [draggingId, setDraggingId] = useState<SidebarTabId | null>(null)
  const [dropTargetId, setDropTargetId] = useState<SidebarTabId | null>(null)
  // Horizontal halfway-point detection for the strip — left half = drop
  // BEFORE the target, right half = AFTER. Stored in a ref because the
  // drop event needs the most-recent value (state would lag a tick).
  const dropPos = useRef<'before' | 'after'>('before')

  const handleDragStart = (id: SidebarTabId) => (e: React.DragEvent) => {
    e.dataTransfer.setData(TAB_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(id)
  }

  const handleDragOver = (id: SidebarTabId) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropPos.current = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after'
    setDropTargetId(id)
  }

  const handleDragLeave = () => {
    setDropTargetId(null)
  }

  const handleDrop = (targetId: SidebarTabId) => (e: React.DragEvent) => {
    const droppedId = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    if (!droppedId || droppedId === targetId) {
      setDraggingId(null); setDropTargetId(null); return
    }
    e.preventDefault()
    const next = orderedIds.filter(id => id !== droppedId)
    const idx = next.indexOf(targetId)
    if (idx === -1) {
      next.push(droppedId)
    } else {
      next.splice(dropPos.current === 'before' ? idx : idx + 1, 0, droppedId)
    }
    setSidebarTabOrder(next)
    setDraggingId(null); setDropTargetId(null)
  }

  const handleDragEnd = () => {
    setDraggingId(null); setDropTargetId(null)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-obsidianBorder">
      <div className="flex items-center gap-0.5 px-1 py-1 border-b border-obsidianBorder bg-obsidianDarkGray/40">
        {orderedIds.map(id => {
          const def = tabsById.get(id)
          if (!def) return null
          const active = tabId === id
          const dragging = draggingId === id
          const isDropTarget = dropTargetId === id
          const Icon = def.Icon
          return (
            <div
              key={id}
              draggable
              onDragStart={handleDragStart(id)}
              onDragOver={handleDragOver(id)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(id)}
              onDragEnd={handleDragEnd}
              className={[
                'flex-1 relative',
                dragging ? 'opacity-40' : '',
                isDropTarget && dropPos.current === 'before' ? 'border-l-2 border-obsidianAccentPurple -ml-[2px]' : '',
                isDropTarget && dropPos.current === 'after'  ? 'border-r-2 border-obsidianAccentPurple -mr-[2px]' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => setTab(id)}
                title={def.title}
                aria-label={def.title}
                aria-pressed={active}
                data-testid={`sidebar-tab-${id}`}
                className={`w-full flex items-center justify-center py-1.5 rounded transition-colors ${
                  active
                    ? 'bg-obsidianHighlight text-obsidianText'
                    : 'text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText'
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            </div>
          )
        })}
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

export default SidebarStack
