'use client'

import { useMemo, useRef, useState } from 'react'
import {
  MagnifyingGlassIcon,
  DocumentPlusIcon,
  CalendarDaysIcon,
  CommandLineIcon,
  RectangleStackIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'
import { PanelLeftIcon, PanelRightIcon } from '@/components/ui'
import { useShallow } from 'zustand/react/shallow'
import {
  useUIStore,
  useSettingsStore,
  useWorkspaceStore,
  useNoteStore,
  type SidebarTabId,
} from '@/stores'
import { SIDEBAR_PANEL_DRAG_MIME } from './SidebarSection'
import {
  PANELS,
  KNOWN_IDS,
  TAB_DRAG_MIME,
  resolveTabOrder,
} from './sidebarPanelRegistry'
import {
  pinAsNewGroup,
  unpinPanel,
} from './pinningActions'

// Obsidian-style "Activity Bar" — the single vertical icon column on
// the far left. From top to bottom it hosts:
//
//   1. Collapse-sidebar toggle (replaces the chevron that used to sit
//      in the Sidebar header).
//   2. PINNED panel icons — one per pinned group; clicking opens that
//      panel + the sidebar. Drag DOWN past the separator → unpin.
//   3. UNPINNED panel icons — every visible panel not currently pinned.
//      Clicking activates that panel + opens the sidebar. Drag UP past
//      the separator (or onto a pinned icon) → pin as new group.
//   4. Quick-launch ACTIONS (new-note, daily-note, command-palette,
//      templates) — user-reorderable via drag, order persists in
//      `useSettingsStore.ribbonOrder`. These don't write to the sidebar
//      tab state; they each fire a discrete action.
//   5. Settings at the bottom (mt-auto).
//
// The PRE-2026-06 separate horizontal tab strip inside the sidebar (TabSwitcher
// icons row) is gone — panel switching now happens here, single-source-of-truth.
// Pinned groups still render their PinnedMiniStrip above their content
// for choosing the active tab WITHIN a group. The "ActivityBar" name
// mirrors VS Code; we keep the export named `Ribbon` so existing tests
// and callers stay green without a rename pass.

// Action ids. Adding a new id requires extending this union AND adding
// an entry to `ITEMS` below. The ordering inside `ITEMS` is the default
// rendering order when the user has no saved customisation.
type ItemId =
  | 'new-note'
  | 'daily-note'
  | 'command-palette'
  | 'templates'

interface ItemDef {
  id: ItemId
  Icon: typeof DocumentPlusIcon
  title: string
  // Fired on click. Pulls from store getState() inside the action to
  // avoid prop drilling — the bar doesn't need to re-render when
  // unrelated store fields change.
  action: () => void
}

// Source-of-truth list. New ids get appended here; resolveRibbonOrder
// merges with the user's saved order at render time.
const ITEMS: readonly ItemDef[] = [
  {
    id: 'new-note',
    Icon: DocumentPlusIcon,
    title: 'New note (Alt+N)',
    action: () => {
      const note = useNoteStore.getState().addNote({ folderId: null })
      useWorkspaceStore.getState().openNote(note.id, { preview: false })
    },
  },
  {
    id: 'daily-note',
    Icon: CalendarDaysIcon,
    title: "Open today's daily note",
    action: () => {
      // Lazy import keeps the bar free of a hard daily-notes
      // dependency at module load (same pattern useKeyboardShortcuts
      // uses for the Ctrl+Alt+D shortcut).
      void import('@/utils/dailyNotes').then(({ openTodayNote }) => openTodayNote())
    },
  },
  {
    id: 'command-palette',
    Icon: CommandLineIcon,
    title: 'Command palette',
    action: () => useUIStore.getState().openModal({ type: 'command-palette' }),
  },
  {
    id: 'templates',
    Icon: RectangleStackIcon,
    title: 'Templates',
    action: () => useUIStore.getState().openModal({ type: 'template' }),
  },
]

// Merge the user's saved order with the source order, dropping ids that
// no longer exist and appending any new ids. Pure function — easy to test.
export function resolveRibbonOrder(saved: string[]): ItemId[] {
  const known = new Set(ITEMS.map(i => i.id))
  const seen = new Set<string>()
  const out: ItemId[] = []
  for (const id of saved) {
    if (known.has(id as ItemId) && !seen.has(id)) {
      seen.add(id)
      out.push(id as ItemId)
    }
  }
  for (const item of ITEMS) {
    if (!seen.has(item.id)) out.push(item.id)
  }
  return out
}

const RIBBON_DRAG_MIME = 'application/x-noteser-ribbon-item'

export const Ribbon = () => {
  const openSearch = useUIStore(s => s.openSearch)
  const openModal = useUIStore(s => s.openModal)
  const sidebarCollapsed = useUIStore(s => s.sidebarCollapsed)
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  const setSidebarTab = useUIStore(s => s.setSidebarTab)
  const activeSidebarTab = useUIStore(s => s.sidebarTabId)

  // Settings-store slice for the panel layout. useShallow avoids a
  // re-render on every unrelated settings change.
  const {
    ribbonOrder,
    setRibbonOrder,
    pinnedPanels,
    sidebarTabOrder,
    hiddenSidebarTabs,
  } = useSettingsStore(useShallow(s => ({
    ribbonOrder: s.ribbonOrder,
    setRibbonOrder: s.setRibbonOrder,
    pinnedPanels: s.pinnedPanels,
    sidebarTabOrder: s.sidebarTabOrder,
    hiddenSidebarTabs: s.hiddenSidebarTabs,
  })))

  // Same sanitisation SidebarStack does on the raw value — drop unknown
  // ids, drop empties, de-dup, drop hidden. Keeps the activity bar in
  // sync with what the sidebar renders.
  const hiddenSet = useMemo(() => new Set(hiddenSidebarTabs), [hiddenSidebarTabs])
  const pinnedGroups = useMemo<SidebarTabId[][]>(() => {
    const seen = new Set<string>()
    const out: SidebarTabId[][] = []
    for (const group of pinnedPanels) {
      if (!Array.isArray(group)) continue
      const cleaned: SidebarTabId[] = []
      for (const id of group) {
        if (KNOWN_IDS.has(id as SidebarTabId) && !seen.has(id) && !hiddenSet.has(id)) {
          seen.add(id)
          cleaned.push(id as SidebarTabId)
        }
      }
      if (cleaned.length > 0) out.push(cleaned)
    }
    return out
  }, [pinnedPanels, hiddenSet])
  const pinnedFlat = useMemo(() => pinnedGroups.flat(), [pinnedGroups])

  // One icon per pinned group — using the group's first id as the
  // visual. Clicking the icon focuses that panel + opens the sidebar.
  const pinnedIconIds = useMemo<SidebarTabId[]>(
    () => pinnedGroups.map(g => g[0]),
    [pinnedGroups],
  )
  const unpinnedIds = useMemo<SidebarTabId[]>(
    () => resolveTabOrder(sidebarTabOrder, pinnedFlat).filter(id => !hiddenSet.has(id)),
    [sidebarTabOrder, pinnedFlat, hiddenSet],
  )

  const orderedIds = useMemo(() => resolveRibbonOrder(ribbonOrder), [ribbonOrder])
  const itemsById = useMemo(() => new Map(ITEMS.map(i => [i.id, i])), [])
  const panelsById = useMemo(() => new Map(PANELS.map(p => [p.id, p])), [])

  // Open `id` as the active panel + uncollapse sidebar if collapsed.
  // Pinned icons that already correspond to a pinned group activate by
  // simply setting the sidebar tab; the PinnedGroup component reads its
  // own activeTab so this is mostly a "make sure the sidebar is open"
  // affordance for pinned icons.
  const activatePanel = (id: SidebarTabId) => {
    setSidebarTab(id)
    if (sidebarCollapsed) toggleSidebar()
  }

  // ── Ribbon-action drag (unchanged behaviour) ─────────────────────────
  const [draggingId, setDraggingId] = useState<ItemId | null>(null)
  const [dropTargetId, setDropTargetId] = useState<ItemId | null>(null)
  const dropPos = useRef<'before' | 'after'>('before')

  const handleDragStart = (id: ItemId) => (e: React.DragEvent) => {
    // Primary-button guard — keeps right-click from ghost-dragging
    // ribbon icons (Firefox + Chromium-Linux quirk).
    if (e.nativeEvent && e.nativeEvent.button !== 0) return
    e.dataTransfer.setData(RIBBON_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(id)
  }
  const handleDragOver = (id: ItemId) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(RIBBON_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropPos.current = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after'
    setDropTargetId(id)
  }
  const handleDragLeave = () => setDropTargetId(null)
  const handleDrop = (targetId: ItemId) => (e: React.DragEvent) => {
    const droppedId = e.dataTransfer.getData(RIBBON_DRAG_MIME) as ItemId
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
    setRibbonOrder(next)
    setDraggingId(null); setDropTargetId(null)
  }
  const handleDragEnd = () => {
    setDraggingId(null); setDropTargetId(null)
  }

  // ── Panel-icon drag (pin / unpin) ────────────────────────────────────
  // Pinned icons emit SIDEBAR_PANEL_DRAG_MIME (same as the mini-strip)
  // so PinnedMiniStrip + InterGroupDropZone can still receive them.
  // Unpinned icons emit TAB_DRAG_MIME (same as the old TabSwitcher
  // icons), so the same drop targets accept them.
  const onPinnedDragStart = (id: SidebarTabId) => (e: React.DragEvent) => {
    if (e.nativeEvent && e.nativeEvent.button !== 0) return
    e.dataTransfer.setData(SIDEBAR_PANEL_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
  }
  const onUnpinnedDragStart = (id: SidebarTabId) => (e: React.DragEvent) => {
    if (e.nativeEvent && e.nativeEvent.button !== 0) return
    e.dataTransfer.setData(TAB_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
  }

  // Drop zones inside the bar:
  //   * The pinned-section accepts drops of TAB_DRAG_MIME (unpinned →
  //     pinned). Drops of SIDEBAR_PANEL_DRAG_MIME are passthrough (the
  //     panel is already pinned).
  //   * The unpinned-section accepts drops of SIDEBAR_PANEL_DRAG_MIME
  //     (pinned → unpinned). Drops of TAB_DRAG_MIME are passthrough.
  const [pinDropHot, setPinDropHot] = useState(false)
  const [unpinDropHot, setUnpinDropHot] = useState(false)

  const onPinSectionDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types
    if (!t.includes(TAB_DRAG_MIME) && !t.includes(SIDEBAR_PANEL_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (t.includes(TAB_DRAG_MIME)) setPinDropHot(true)
  }
  const onPinSectionDragLeave = () => setPinDropHot(false)
  const onPinSectionDrop = (e: React.DragEvent) => {
    setPinDropHot(false)
    const dropped = (e.dataTransfer.getData(TAB_DRAG_MIME) || '') as SidebarTabId
    if (!dropped) return
    e.preventDefault()
    pinAsNewGroup(pinnedGroups, dropped)
  }

  const onUnpinSectionDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types
    if (!t.includes(SIDEBAR_PANEL_DRAG_MIME) && !t.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (t.includes(SIDEBAR_PANEL_DRAG_MIME)) setUnpinDropHot(true)
  }
  const onUnpinSectionDragLeave = () => setUnpinDropHot(false)
  const onUnpinSectionDrop = (e: React.DragEvent) => {
    setUnpinDropHot(false)
    const dropped = (e.dataTransfer.getData(SIDEBAR_PANEL_DRAG_MIME) || '') as SidebarTabId
    if (!dropped) return
    e.preventDefault()
    unpinPanel(pinnedGroups, dropped)
  }

  const showSeparator = pinnedIconIds.length > 0 && unpinnedIds.length > 0

  return (
    <div className="h-full w-[44px] max-md:w-12 flex flex-col items-center gap-1 py-2 bg-obsidianBlack border-r border-obsidianBorder">
      {/* Collapse-sidebar toggle. Moved from the Sidebar header so the
          activity bar owns the chrome that survives a collapsed
          sidebar. Visible on every viewport — on mobile the same flag
          drives the drawer-open state, so the icon doubles as
          open/close. */}
      <RibbonButton
        onClick={toggleSidebar}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        testId="activity-bar-collapse-toggle"
      >
        {sidebarCollapsed
          ? <PanelRightIcon className="w-5 h-5" />
          : <PanelLeftIcon className="w-5 h-5" />}
      </RibbonButton>

      <Separator />

      {/* Pinned panel icons. Single icon per group. Right-click pops
          a tiny native-style context menu via the existing approach
          would require lifting state up — instead we keep this minimal
          and let the in-sidebar PinnedMiniStrip own per-tab right-click
          (it already does). Dragging this icon DOWN onto the unpinned
          drop zone unpins it. */}
      <div
        className={`flex flex-col items-center gap-1 w-full ${
          pinnedIconIds.length === 0 ? 'min-h-0' : ''
        } ${pinDropHot ? 'bg-obsidianAccentPurple/15' : ''}`}
        onDragOver={onPinSectionDragOver}
        onDragLeave={onPinSectionDragLeave}
        onDrop={onPinSectionDrop}
        data-testid="activity-bar-pinned-section"
      >
        {pinnedIconIds.map(id => {
          const def = panelsById.get(id)
          if (!def) return null
          const Icon = def.Icon
          const active = activeSidebarTab === id
          return (
            <div
              key={`pinned-${id}`}
              draggable
              onDragStart={onPinnedDragStart(id)}
              data-testid={`activity-bar-pinned-${id}`}
            >
              <RibbonButton
                onClick={() => activatePanel(id)}
                title={`${def.title} (pinned) — drag down to unpin`}
                active={active}
              >
                <Icon className="w-5 h-5" />
              </RibbonButton>
            </div>
          )
        })}
        {pinnedIconIds.length === 0 && pinDropHot && (
          // Tiny visual breadcrumb during a drag-to-pin into the
          // empty pinned section so the user has a target.
          <div className="text-[10px] text-obsidianAccentPurple/80 px-1 text-center" data-testid="activity-bar-pin-hint">
            Pin
          </div>
        )}
      </div>

      {showSeparator && <Separator />}

      {/* Unpinned panel icons. Drag UP onto the pinned drop zone to
          pin (the unpinned icon emits TAB_DRAG_MIME which the pin
          section accepts). */}
      <div
        className={`flex flex-col items-center gap-1 w-full ${
          unpinDropHot ? 'bg-obsidianAccentPurple/15' : ''
        }`}
        onDragOver={onUnpinSectionDragOver}
        onDragLeave={onUnpinSectionDragLeave}
        onDrop={onUnpinSectionDrop}
        data-testid="activity-bar-unpinned-section"
      >
        {unpinnedIds.map(id => {
          const def = panelsById.get(id)
          if (!def) return null
          const Icon = def.Icon
          const active = activeSidebarTab === id
          return (
            <div
              key={`unpinned-${id}`}
              draggable
              onDragStart={onUnpinnedDragStart(id)}
              data-testid={`activity-bar-unpinned-${id}`}
            >
              <RibbonButton
                onClick={() => activatePanel(id)}
                title={`${def.title} — drag up to pin`}
                active={active}
              >
                <Icon className="w-5 h-5" />
              </RibbonButton>
            </div>
          )
        })}
      </div>

      <Separator />

      {/* Quick-launch ACTIONS — search + new-note + daily-note + ... */}
      <RibbonButton onClick={openSearch} title="Search (Ctrl+K)">
        <MagnifyingGlassIcon className="w-5 h-5" />
      </RibbonButton>

      {orderedIds.map(id => {
        const item = itemsById.get(id)
        if (!item) return null
        const Icon = item.Icon
        const dragging = draggingId === id
        const isDropTarget = dropTargetId === id
        return (
          <div
            key={id}
            data-testid={`ribbon-item-${id}`}
            draggable
            onDragStart={handleDragStart(id)}
            onDragOver={handleDragOver(id)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(id)}
            onDragEnd={handleDragEnd}
            className={[
              'relative',
              dragging ? 'opacity-40' : '',
              isDropTarget && dropPos.current === 'before' ? 'border-t-2 border-obsidianAccentPurple -mt-[2px]' : '',
              isDropTarget && dropPos.current === 'after'  ? 'border-b-2 border-obsidianAccentPurple -mb-[2px]' : '',
            ].join(' ')}
          >
            <RibbonButton onClick={item.action} title={item.title}>
              <Icon className="w-5 h-5" />
            </RibbonButton>
          </div>
        )
      })}

      <div className="mt-auto">
        <RibbonButton onClick={() => openModal({ type: 'settings' })} title="Settings">
          <Cog6ToothIcon className="w-5 h-5" />
        </RibbonButton>
      </div>
    </div>
  )
}

const Separator = () => (
  <div className="w-7 border-t border-obsidianBorder/60 my-1" aria-hidden="true" />
)

const RibbonButton = ({
  onClick, title, children, active, testId,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
  active?: boolean
  testId?: string
}) => (
  <button
    onClick={onClick}
    title={title}
    data-testid={testId}
    aria-pressed={active}
    className={[
      'p-2 max-md:p-2.5 rounded transition-colors inline-flex items-center justify-center max-md:min-w-[44px] max-md:min-h-[44px]',
      active
        ? 'bg-obsidianHighlight text-obsidianText'
        : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText',
    ].join(' ')}
  >
    {children}
  </button>
)

export default Ribbon
