'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

  // Sanitise pinnedPanels: outer array = groups, each inner array =
  // tabs in that group. Drop unknown ids, drop empty groups, de-dupe
  // across groups (a panel can only live in one place). Returns
  // SidebarTabId[][].
  const pinnedGroups = useMemo<SidebarTabId[][]>(() => {
    const seen = new Set<string>()
    const out: SidebarTabId[][] = []
    for (const group of pinnedSaved) {
      if (!Array.isArray(group)) continue
      const cleaned: SidebarTabId[] = []
      for (const id of group) {
        if (KNOWN_IDS.has(id as SidebarTabId) && !seen.has(id)) {
          seen.add(id)
          cleaned.push(id as SidebarTabId)
        }
      }
      if (cleaned.length > 0) out.push(cleaned)
    }
    return out
  }, [pinnedSaved])

  // Flat list of every pinned id — handy for resolveTabOrder + lookup.
  const pinnedFlat = useMemo<SidebarTabId[]>(
    () => pinnedGroups.flat(),
    [pinnedGroups],
  )

  // ── Pin/unpin / group ops ────────────────────────────────────────────
  // pinAsNewGroup creates a NEW group at the bottom of the pinned
  // stack containing just `id`. Used by right-click-on-main-strip and
  // drag-to-pin-drop-zone.
  const pinAsNewGroup = (id: SidebarTabId) => {
    if (pinnedFlat.includes(id)) return
    setPinnedPanels([...pinnedGroups, [id]])
  }
  // pinIntoGroup adds `id` to an existing group at `groupIndex`. Used
  // when the user drops a tab onto an existing pinned mini-strip.
  // If `id` is already pinned elsewhere, it's moved (removed from
  // its previous group first).
  const pinIntoGroup = (id: SidebarTabId, groupIndex: number) => {
    const next: SidebarTabId[][] = pinnedGroups
      .map(g => g.filter(p => p !== id))
      .filter(g => g.length > 0)
    // groupIndex may have shifted if we just removed an empty group
    // before it. Re-find the target by panel set (use any remaining
    // id from the original target group as an anchor).
    const targetAnchor = pinnedGroups[groupIndex]?.find(p => p !== id) ?? null
    const realIndex = targetAnchor == null
      ? Math.min(groupIndex, next.length - 1)
      : next.findIndex(g => g.includes(targetAnchor))
    if (realIndex < 0 || realIndex >= next.length) {
      // Target group disappeared (it only contained the dragged id);
      // re-pin as a new solo group at the original spot.
      const insertAt = Math.min(groupIndex, next.length)
      next.splice(insertAt, 0, [id])
    } else {
      next[realIndex] = [...next[realIndex], id]
    }
    setPinnedPanels(next)
  }
  // unpinPanel removes `id` from whatever group it lives in. Empty
  // groups are dropped so we don't leave phantom strips.
  const unpinPanel = (id: SidebarTabId) => {
    if (!pinnedFlat.includes(id)) return
    const next = pinnedGroups
      .map(g => g.filter(p => p !== id))
      .filter(g => g.length > 0)
    setPinnedPanels(next)
  }
  // pinAsNewGroupAt creates a NEW solo group at a specific position
  // in the stack. Used by the inter-group drop zones so the user
  // can insert a new pane between two existing ones precisely.
  const pinAsNewGroupAt = (id: SidebarTabId, insertAt: number) => {
    const next = pinnedGroups
      .map(g => g.filter(p => p !== id))
      .filter(g => g.length > 0)
    next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, [id])
    setPinnedPanels(next)
  }

  // Track whether a sidebar drag is in flight. Used to inflate the
  // drop zones (main pin-zone + inter-group zones) so the user can
  // hit them more easily. Window-level dragstart / dragend listener
  // so we react regardless of which child started the drag.
  const [dragActive, setDragActive] = useState(false)
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      const t = e.dataTransfer?.types
      if (!t) return
      if (t.includes(TAB_DRAG_MIME) || t.includes(SIDEBAR_PANEL_DRAG_MIME)) {
        setDragActive(true)
      }
    }
    const onEnd = () => setDragActive(false)
    window.addEventListener('dragstart', onStart)
    window.addEventListener('dragend', onEnd)
    window.addEventListener('drop', onEnd)
    return () => {
      window.removeEventListener('dragstart', onStart)
      window.removeEventListener('dragend', onEnd)
      window.removeEventListener('drop', onEnd)
    }
  }, [])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Scrollable pinned area — lets the user stack arbitrarily
          many groups without crowding out the main tab strip below.
          max-h-[60%] caps it so the bottom switcher stays reachable;
          internal scroll handles the rest. */}
      {pinnedGroups.length > 0 && (
        <div className="flex-shrink min-h-0 overflow-y-auto" style={{ maxHeight: '60%' }}>
          {pinnedGroups.map((group, groupIndex) => (
            <div key={group.join(',')}>
              {/* Inter-group drop zone ABOVE this group. During drag
                  it's tall + visibly highlighted; otherwise zero-height. */}
              <InterGroupDropZone
                active={dragActive}
                onDropId={(id) => pinAsNewGroupAt(id, groupIndex)}
              />
              <PinnedGroup
                group={group}
                onUnpin={unpinPanel}
                onAddToThisGroup={(otherId) => pinIntoGroup(otherId, groupIndex)}
                onRightClick={onRightClick}
              />
            </div>
          ))}
          {/* Trailing zone — insert a new group at the end. */}
          <InterGroupDropZone
            active={dragActive}
            onDropId={(id) => pinAsNewGroupAt(id, pinnedGroups.length)}
          />
        </div>
      )}
      <TabSwitcher
        pinnedIds={pinnedFlat}
        tabOrderSaved={tabOrderSaved}
        onRightClick={onRightClick}
        onPinPanel={pinAsNewGroup}
        onUnpinPanel={unpinPanel}
        dragActive={dragActive}
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
  // True when ANY sidebar drag is in flight — inflates the pin-zone
  // so the user can land a drop without pixel-precise hovering.
  dragActive: boolean
}

const TabSwitcher = ({
  pinnedIds, tabOrderSaved, onRightClick, onPinPanel, onUnpinPanel, dragActive,
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
      {/* Pin drop zone — visible whenever ANY sidebar drag is in
          flight, not just a drag started from this strip. The
          inflated 24px height makes the target easy to land on
          (the user complained that 6px was too thin). */}
      <div
        onDragOver={onPinDropOver}
        onDragLeave={() => setPinDropActive(false)}
        onDrop={onPinDrop}
        className={`${(draggingId || dragActive) ? 'h-6' : 'h-0'} transition-all flex-shrink-0 flex items-center justify-center text-[10px] uppercase tracking-wide ${
          pinDropActive
            ? 'bg-obsidianAccentPurple text-white'
            : (draggingId || dragActive)
              ? 'bg-obsidianAccentPurple/15 text-obsidianAccentPurple'
              : 'bg-transparent text-transparent'
        }`}
        aria-label="Drop here to pin tab at top"
        data-testid="sidebar-pin-dropzone"
      >
        {(draggingId || dragActive) && (pinDropActive ? 'Drop to pin' : '↑ pin to top')}
      </div>

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
                  // Right-click pins the tab to the top zone (creating
                  // a new pinned mini-strip group). Pairs with the
                  // drag-up gesture.
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

// A pinned GROUP: a mini tab strip (one or more icons) + the active
// tab's content below. Single-icon strips look like a labelled
// pinned panel; multi-icon strips behave like a tiny tab switcher.
//
// State that's local to the group: which tab is active (defaults to
// the first id). We hold it inside the component because group
// composition is keyed on `group.join(',')` from the parent, so
// adding/removing members remounts and naturally resets to a sane
// default.
interface PinnedGroupProps {
  group: SidebarTabId[]
  onUnpin: (id: SidebarTabId) => void
  // The parent uses this to ADD a tab into this group. Called from
  // the mini-strip's drop handler when a tab is dragged from
  // elsewhere onto this group's strip.
  onAddToThisGroup: (id: SidebarTabId) => void
  onRightClick: Props['onRightClick']
}

const PinnedGroup = ({
  group, onUnpin, onAddToThisGroup, onRightClick,
}: PinnedGroupProps) => {
  const [activeTab, setActiveTab] = useState<SidebarTabId>(group[0])
  // If the group composition changed and the previous active tab is
  // gone, snap to the first available.
  const safeActive = group.includes(activeTab) ? activeTab : group[0]
  return (
    <div className="flex-shrink-0 flex flex-col border-t border-obsidianBorder">
      <PinnedMiniStrip
        ids={group}
        activeId={safeActive}
        onActivate={setActiveTab}
        onUnpin={onUnpin}
        onAddToThisGroup={onAddToThisGroup}
      />
      <SidebarSection
        id={safeActive}
        title={PANELS.find(p => p.id === safeActive)?.title ?? safeActive}
        hideHeader={true}
        onHeaderContextMenu={e => { e.preventDefault(); onUnpin(safeActive) }}
      >
        <PanelBody id={safeActive} onRightClick={onRightClick} />
      </SidebarSection>
    </div>
  )
}

// Mini tab strip rendered ABOVE each pinned group's content. One
// icon per panel in the group; the active icon is highlighted.
// Click an icon to switch the group's active tab. The strip is
// a drag source (each icon draggable — drop elsewhere = move/unpin)
// AND a drop target (drop a tab from the main strip or another
// group here = add to this group). Right-click toggles pin/unpin.
interface PinnedMiniStripProps {
  ids: SidebarTabId[]
  activeId: SidebarTabId
  onActivate: (id: SidebarTabId) => void
  onUnpin: (id: SidebarTabId) => void
  onAddToThisGroup: (id: SidebarTabId) => void
}

const PinnedMiniStrip = ({
  ids, activeId, onActivate, onUnpin, onAddToThisGroup,
}: PinnedMiniStripProps) => {
  const [dropActive, setDropActive] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    const has = e.dataTransfer.types.includes(TAB_DRAG_MIME)
      || e.dataTransfer.types.includes(SIDEBAR_PANEL_DRAG_MIME)
    if (!has) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropActive(true)
  }
  const handleDragLeave = () => setDropActive(false)
  const handleDrop = (e: React.DragEvent) => {
    setDropActive(false)
    const tabDrag = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    const panelDrag = e.dataTransfer.getData(SIDEBAR_PANEL_DRAG_MIME) as SidebarTabId
    const droppedId = (tabDrag || panelDrag) as SidebarTabId
    if (!droppedId) return
    if (ids.includes(droppedId)) return
    e.preventDefault()
    onAddToThisGroup(droppedId)
  }

  return (
    <div
      className={`flex items-center gap-0.5 px-1 py-1 border-b border-obsidianBorder bg-obsidianDarkGray/40 ${
        dropActive ? 'outline outline-2 outline-obsidianAccentPurple/60' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {ids.map(id => {
        const def = PANELS.find(p => p.id === id)
        if (!def) return null
        const Icon = def.Icon
        const active = id === activeId
        return (
          <button
            key={id}
            type="button"
            draggable
            onDragStart={e => {
              e.dataTransfer.setData(SIDEBAR_PANEL_DRAG_MIME, id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => onActivate(id)}
            onContextMenu={e => { e.preventDefault(); onUnpin(id) }}
            title={`${def.title} — right-click to unpin`}
            aria-label={def.title}
            aria-pressed={active}
            data-testid={`sidebar-pinned-tab-${id}`}
            className={`flex items-center justify-center py-1.5 px-3 rounded cursor-grab active:cursor-grabbing transition-colors ${
              active
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText'
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        )
      })}
    </div>
  )
}

// Thin drop zone rendered ABOVE each pinned group (and once at the
// end of the pinned area) so the user can position a new group
// between two existing ones. Zero-height when nothing's being
// dragged, inflates to 24px during a drag for an easy target.
interface InterGroupDropZoneProps {
  active: boolean
  onDropId: (id: SidebarTabId) => void
}

const InterGroupDropZone = ({ active, onDropId }: InterGroupDropZoneProps) => {
  const [hot, setHot] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types
    if (!t.includes(TAB_DRAG_MIME) && !t.includes(SIDEBAR_PANEL_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setHot(true)
  }
  const handleDragLeave = () => setHot(false)
  const handleDrop = (e: React.DragEvent) => {
    setHot(false)
    const tabDrag = e.dataTransfer.getData(TAB_DRAG_MIME) as SidebarTabId
    const panelDrag = e.dataTransfer.getData(SIDEBAR_PANEL_DRAG_MIME) as SidebarTabId
    const id = (tabDrag || panelDrag) as SidebarTabId
    if (!id) return
    e.preventDefault()
    onDropId(id)
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`${active ? 'h-6' : 'h-0'} transition-all flex-shrink-0 flex items-center justify-center text-[10px] uppercase tracking-wide ${
        hot
          ? 'bg-obsidianAccentPurple text-white'
          : active
            ? 'bg-obsidianAccentPurple/10 text-obsidianAccentPurple/70 border-y border-dashed border-obsidianAccentPurple/30'
            : 'bg-transparent text-transparent'
      }`}
      data-testid="sidebar-inter-group-dropzone"
    >
      {active && (hot ? 'Drop here for a new pane' : '↓ new pane here')}
    </div>
  )
}

export default SidebarStack
