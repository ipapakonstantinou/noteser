'use client'

import { useMemo, useRef, useState } from 'react'
import {
  CalendarDaysIcon,
  ListBulletIcon,
  DocumentDuplicateIcon,
  MagnifyingGlassIcon,
  BookmarkIcon,
  CodeBracketIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useSettingsStore, type SidebarTabId } from '@/stores'
import { FolderTree } from './FolderTree'
import { FolderTreeToolbar } from './FolderTreeToolbar'
import { CalendarView } from './CalendarView'
import { OutlineView } from './OutlineView'
import { GitHubView } from './GitHubView'
import { SidebarSection, SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import { SidebarSearchPanel } from './SidebarSearchPanel'
import { SidebarBookmarksPanel } from './SidebarBookmarksPanel'
import { SidebarRelatedPanel } from './SidebarRelatedPanel'

interface Props {
  onRightClick: (e: React.MouseEvent, type: 'note' | 'folder', id: string) => void
}

// Panel registry. Every entry can live in either zone — pinnedPanels
// determines which. The Files panel uses the FolderTreeToolbar shell;
// the others render their view component directly.
interface PanelDef {
  id: SidebarTabId
  Icon: typeof DocumentDuplicateIcon
  title: string
}

const PANELS: readonly PanelDef[] = [
  { id: 'calendar',       Icon: CalendarDaysIcon,      title: 'Calendar' },
  { id: 'files',          Icon: DocumentDuplicateIcon, title: 'Files' },
  { id: 'outline',        Icon: ListBulletIcon,        title: 'Outline' },
  { id: 'source-control', Icon: CodeBracketIcon,       title: 'Source control' },
  { id: 'search',         Icon: MagnifyingGlassIcon,   title: 'Search' },
  { id: 'bookmarks',      Icon: BookmarkIcon,          title: 'Bookmarks' },
  { id: 'related',        Icon: LinkIcon,              title: 'Related notes' },
]

const KNOWN_IDS = new Set<SidebarTabId>(PANELS.map(p => p.id))

// Pure: merge the saved tab order with the source order, then filter
// out anything that's pinned (so the strip never duplicates pinned
// panels). Exported for the unit test.
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
    // Skip pinned. Calendar specifically is pinned by default and only
    // shows in the strip when the user has explicitly unpinned it.
    if (pinnedSet.has(p.id)) continue
    if (seen.has(p.id)) continue
    out.push(p.id)
  }
  return out
}

// Render the panel body for a given id — used by both zones so the
// pinned section and the tab strip's active content stay in sync.
const PanelBody = ({
  id, onRightClick,
}: { id: SidebarTabId; onRightClick: Props['onRightClick'] }) => {
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

export const SidebarStack = ({ onRightClick }: Props) => {
  const pinnedSaved = useSettingsStore(s => s.pinnedPanels)
  const setPinnedPanels = useSettingsStore(s => s.setPinnedPanels)
  const tabOrderSaved = useSettingsStore(s => s.sidebarTabOrder)

  // Sanitise pinnedPanels: drop unknowns, de-dupe. Without this an old
  // persisted entry would render a phantom section.
  const pinnedIds = useMemo(() => {
    const seen = new Set<string>()
    const out: SidebarTabId[] = []
    for (const id of pinnedSaved) {
      if (KNOWN_IDS.has(id as SidebarTabId) && !seen.has(id)) {
        seen.add(id)
        out.push(id as SidebarTabId)
      }
    }
    return out
  }, [pinnedSaved])

  // ── Pin/unpin operations ─────────────────────────────────────────────
  // Move a panel from the tab strip up into the pinned zone, or move a
  // pinned panel down into the tab strip. Both writes go through
  // setPinnedPanels (sidebarTabOrder is left alone — resolveTabOrder
  // filters out pinned ids at render).
  const pinPanel = (id: SidebarTabId) => {
    if (pinnedIds.includes(id)) return
    setPinnedPanels([...pinnedIds, id])
  }
  const unpinPanel = (id: SidebarTabId) => {
    if (!pinnedIds.includes(id)) return
    setPinnedPanels(pinnedIds.filter(p => p !== id))
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {pinnedIds.map(id => {
        const def = PANELS.find(p => p.id === id)
        if (!def) return null
        const Icon = def.Icon
        return (
          <SidebarSection
            key={id}
            id={id}
            title={def.title}
            icon={<Icon className="w-3.5 h-3.5" />}
            draggablePanelId={id}
            // The Calendar panel renders without a section header —
            // the user explicitly asked for it to look like the file
            // tree below (no chevron + "CALENDAR" bar). Other panels
            // keep the standard header so they're still discoverable
            // when stacked.
            hideHeader={id === 'calendar'}
            onHeaderContextMenu={e => {
              // Right-click on a pinned section header (or content
              // body, when the header is hidden) unpins it back into
              // the tab strip. Pairs with the right-click-to-pin
              // gesture on the tab icons below.
              e.preventDefault()
              unpinPanel(id)
            }}
          >
            <PanelBody id={id} onRightClick={onRightClick} />
          </SidebarSection>
        )
      })}
      <TabSwitcher
        pinnedIds={pinnedIds}
        tabOrderSaved={tabOrderSaved}
        onRightClick={onRightClick}
        onPinPanel={pinPanel}
        onUnpinPanel={unpinPanel}
      />
    </div>
  )
}

const TAB_DRAG_MIME = 'application/x-noteser-sidebar-tab'

interface TabSwitcherProps {
  pinnedIds: SidebarTabId[]
  tabOrderSaved: string[]
  onRightClick: Props['onRightClick']
  onPinPanel: (id: SidebarTabId) => void
  onUnpinPanel: (id: SidebarTabId) => void
}

const TabSwitcher = ({
  pinnedIds, tabOrderSaved, onRightClick, onPinPanel, onUnpinPanel,
}: TabSwitcherProps) => {
  const tabId = useUIStore(s => s.sidebarTabId)
  const setTab = useUIStore(s => s.setSidebarTab)
  const setSidebarTabOrder = useSettingsStore(s => s.setSidebarTabOrder)

  const orderedIds = useMemo(
    () => resolveTabOrder(tabOrderSaved, pinnedIds),
    [tabOrderSaved, pinnedIds],
  )
  // The store may hold a tabId that's currently pinned (e.g. user just
  // pinned the active tab). In that case fall back to the first id in
  // the strip so the panel content area isn't blank.
  const effectiveTabId: SidebarTabId | null = pinnedIds.includes(tabId)
    ? (orderedIds[0] ?? null)
    : tabId

  const panelsById = useMemo(() => new Map(PANELS.map(p => [p.id, p])), [])

  const [draggingId, setDraggingId] = useState<SidebarTabId | null>(null)
  const [dropTargetId, setDropTargetId] = useState<SidebarTabId | null>(null)
  const dropPos = useRef<'before' | 'after'>('before')

  // Pin-zone drop indicator. When a tab is being dragged near the top
  // edge of the strip we light up a horizontal bar that doubles as the
  // pin-target — drop here = move to pinned-top.
  const [pinDropActive, setPinDropActive] = useState(false)

  const handleDragStart = (id: SidebarTabId) => (e: React.DragEvent) => {
    e.dataTransfer.setData(TAB_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(id)
  }

  const handleDragOver = (id: SidebarTabId) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME) && !e.dataTransfer.types.includes(SIDEBAR_PANEL_DRAG_MIME)) return
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
    // Two kinds of payload: a tab-strip drag (reorder within strip)
    // or a pinned-section drag (move from pinned-top to strip).
    const droppedFromTab = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    const droppedFromPin = e.dataTransfer.getData(SIDEBAR_PANEL_DRAG_MIME) as SidebarTabId
    const droppedId = (droppedFromTab || droppedFromPin) as SidebarTabId | ''
    if (!droppedId) {
      setDraggingId(null); setDropTargetId(null); return
    }
    e.preventDefault()

    // Coming FROM pinned → unpin first, then place in tab order.
    if (droppedFromPin) {
      onUnpinPanel(droppedId)
    }
    if (droppedId === targetId) {
      setDraggingId(null); setDropTargetId(null); return
    }

    // Compute the new tab order. We use the freshly-computed strip
    // (orderedIds) as the base — for the pin→tab case we add the
    // unpinned id; for the in-strip case we already have it.
    const base = droppedFromPin
      ? [...orderedIds, droppedId]
      : orderedIds
    const next = base.filter(id => id !== droppedId)
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
    setDraggingId(null); setDropTargetId(null); setPinDropActive(false)
  }

  // Pin drop-zone (a 6px-tall strip above the tab strip). Listens for
  // tab-MIME payloads; on drop, pins the dragged tab.
  const onPinDropOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setPinDropActive(true)
  }
  const onPinDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    setPinDropActive(false)
    if (!id) return
    e.preventDefault()
    onPinPanel(id)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-obsidianBorder">
      {/* Pin drop zone — only meaningful when a tab is being dragged. */}
      <div
        onDragOver={onPinDropOver}
        onDragLeave={() => setPinDropActive(false)}
        onDrop={onPinDrop}
        className={`${draggingId ? 'h-1.5' : 'h-0'} transition-all flex-shrink-0 ${
          pinDropActive ? 'bg-obsidianAccentPurple' : 'bg-transparent'
        }`}
        aria-label="Drop here to pin tab at top"
        data-testid="sidebar-pin-dropzone"
      />

      <div className="flex items-center gap-0.5 px-1 py-1 border-b border-obsidianBorder bg-obsidianDarkGray/40">
        {orderedIds.map(id => {
          const def = panelsById.get(id)
          if (!def) return null
          const active = effectiveTabId === id
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
                onContextMenu={e => {
                  // Right-click pins the tab to the top section. The
                  // drag-up-to-pin gesture also works but is invisible
                  // until drag starts — this is the discoverable
                  // alternative.
                  e.preventDefault()
                  onPinPanel(id)
                }}
                title={`${def.title} — right-click to pin to top`}
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
        {effectiveTabId && <PanelBody id={effectiveTabId} onRightClick={onRightClick} />}
      </div>
    </div>
  )
}

export default SidebarStack
