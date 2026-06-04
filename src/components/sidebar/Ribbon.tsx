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
import { TabContextMenu } from './TabContextMenu'
import { PANELS, TAB_DRAG_MIME } from './sidebarPanelRegistry'
import { activatePanelFromActivityBar, findGroupWithTab } from './sidebarGroupActions'

// Obsidian-style Activity Bar — the single vertical icon column on the
// far left. Leaf model (2026-06-04): NO "pinned vs unpinned" zones.
// Top to bottom:
//
//   1. Collapse-sidebar toggle.
//   2. PANEL icons — every panel in PANELS order (filtered by
//      hiddenSidebarTabs). Active state = "this panel is the activeTab
//      of any group". Click implements the 4-case logic from
//      activatePanelFromActivityBar (see sidebarGroupActions.ts).
//   3. Quick-launch ACTIONS (new-note, daily-note, command-palette,
//      templates, search) — drag-orderable; saved in
//      useSettingsStore.ribbonOrder.
//   4. Settings at the bottom (mt-auto).
//
// Drag/drop: panel icons emit TAB_DRAG_MIME. Drops onto a sidebar
// group's mini-strip move the tab there; drops onto an inter-group
// drop zone create a new group at that index. Drops back onto the
// activity bar do NOTHING (no implicit "remove from sidebar" — that
// lives on the tab right-click menu).

type ItemId =
  | 'new-note'
  | 'daily-note'
  | 'command-palette'
  | 'templates'

interface ItemDef {
  id: ItemId
  Icon: typeof DocumentPlusIcon
  title: string
  action: () => void
}

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

  const {
    ribbonOrder,
    setRibbonOrder,
    sidebarGroups,
    hiddenSidebarTabs,
    hideSidebarTab,
  } = useSettingsStore(useShallow(s => ({
    ribbonOrder: s.ribbonOrder,
    setRibbonOrder: s.setRibbonOrder,
    sidebarGroups: s.sidebarGroups,
    hiddenSidebarTabs: s.hiddenSidebarTabs,
    hideSidebarTab: s.hideSidebarTab,
  })))

  // Set of panel ids currently parked in ANY sidebar group. Per user
  // feedback (2026-06-04): a panel that is already showing in the
  // sidebar should NOT also have an icon in the activity bar — the
  // group's own mini-strip is its switcher. The activity bar becomes
  // a list of "panels you can OPEN", not "all panels everywhere".
  const inAnyGroup = useMemo(() => {
    const set = new Set<string>()
    for (const g of sidebarGroups) {
      for (const t of g.tabs) set.add(t)
    }
    return set
  }, [sidebarGroups])

  // Hidden set — panels in `hiddenSidebarTabs` are filtered out of the
  // activity bar entirely (Settings → Sidebar can restore them).
  // Combined filter: exclude hidden + already-in-a-group.
  const hiddenSet = useMemo(() => new Set(hiddenSidebarTabs), [hiddenSidebarTabs])
  const visiblePanels = useMemo(
    () => PANELS.filter(p => !hiddenSet.has(p.id) && !inAnyGroup.has(p.id)),
    [hiddenSet, inAnyGroup],
  )

  const orderedIds = useMemo(() => resolveRibbonOrder(ribbonOrder), [ribbonOrder])
  const itemsById = useMemo(() => new Map(ITEMS.map(i => [i.id, i])), [])

  const onPanelClick = (id: SidebarTabId) => {
    activatePanelFromActivityBar(id)
  }

  // Drag handler: emit TAB_DRAG_MIME so sidebar drop zones accept the
  // payload. The receiver's drop handler (e.g. SidebarGroup's strip,
  // InterGroupDropZone) decides whether to move or spawn a group.
  const onPanelDragStart = (id: SidebarTabId) => (e: React.DragEvent) => {
    // Primary-button guard — keeps right-click from ghost-dragging
    // (Firefox + Chromium-Linux quirk reproduced via dragGuards.test).
    if (e.nativeEvent && e.nativeEvent.button !== 0) return
    e.dataTransfer.setData(TAB_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
  }

  // Right-click on a panel icon → mini context menu. The "Close"
  // option here removes the panel from whichever group it's in; if
  // it isn't in any group yet, the menu shows a single "Hide" entry.
  const [panelMenu, setPanelMenu] = useState<{ id: SidebarTabId; x: number; y: number } | null>(null)
  const openPanelMenu = (id: SidebarTabId, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPanelMenu({ id, x: e.clientX, y: e.clientY })
  }
  const closePanelMenu = () => setPanelMenu(null)
  const handleMenuClose = () => {
    if (!panelMenu) return
    const owner = findGroupWithTab(useSettingsStore.getState().sidebarGroups, panelMenu.id)
    if (owner) {
      useSettingsStore.getState().removeTabFromGroup(owner.id, panelMenu.id)
    }
    closePanelMenu()
  }
  const handleMenuHide = () => {
    if (!panelMenu) return
    hideSidebarTab(panelMenu.id)
    closePanelMenu()
  }

  // ── Ribbon-action drag (unchanged) ─────────────────────────────────
  const [draggingId, setDraggingId] = useState<ItemId | null>(null)
  const [dropTargetId, setDropTargetId] = useState<ItemId | null>(null)
  const dropPos = useRef<'before' | 'after'>('before')

  const handleDragStart = (id: ItemId) => (e: React.DragEvent) => {
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

  return (
    <div className="h-full w-[44px] max-md:w-12 flex flex-col items-center gap-1 py-2 bg-obsidianBlack border-r border-obsidianBorder">
      {/* Collapse-sidebar toggle. */}
      <div className="mb-1.5">
        <RibbonButton
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          testId="activity-bar-collapse-toggle"
        >
          {sidebarCollapsed
            ? <PanelRightIcon className="w-5 h-5" />
            : <PanelLeftIcon className="w-5 h-5" />}
        </RibbonButton>
      </div>

      {/* Panel icons — single unified section (leaf model has no
          pinned/unpinned distinction). One icon per visible panel in
          PANELS order; click adds to last-focused group (or focuses
          existing). */}
      <div
        className="flex flex-col items-center gap-1 w-full"
        data-testid="activity-bar-panels"
      >
        {visiblePanels.map(def => {
          const Icon = def.Icon
          // No `active` state — visiblePanels excludes anything already
          // in a group, so the bar only shows panels available to OPEN.
          return (
            <div
              key={`panel-${def.id}`}
              draggable
              onDragStart={onPanelDragStart(def.id)}
              data-testid={`activity-bar-panel-${def.id}`}
            >
              <RibbonButton
                onClick={() => onPanelClick(def.id)}
                onContextMenu={(e) => openPanelMenu(def.id, e)}
                title={`${def.title} — drag to a sidebar group, right-click for options`}
              >
                <Icon className="w-5 h-5" />
              </RibbonButton>
            </div>
          )
        })}
      </div>

      {/* Quick-launch ACTIONS. */}
      <div className="mt-2 w-full flex flex-col items-center gap-1">
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
      </div>

      <div className="mt-auto">
        <RibbonButton onClick={() => openModal({ type: 'settings' })} title="Settings">
          <Cog6ToothIcon className="w-5 h-5" />
        </RibbonButton>
      </div>

      {panelMenu && (
        <TabContextMenu
          x={panelMenu.x}
          y={panelMenu.y}
          onClose={handleMenuClose}
          onMoveToNewGroup={() => {
            if (!panelMenu) return
            // From the activity bar, "move to new group" creates a
            // fresh group at the BOTTOM of the stack (no source
            // position to anchor on). The action helper already
            // handles the move-from-existing-group case.
            void import('./sidebarGroupActions').then(m => m.moveTabToNewGroup(panelMenu.id))
            closePanelMenu()
          }}
          onHide={handleMenuHide}
          onDismiss={closePanelMenu}
        />
      )}
    </div>
  )
}

const RibbonButton = ({
  onClick, onContextMenu, title, children, active, testId,
}: {
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title: string
  children: React.ReactNode
  active?: boolean
  testId?: string
}) => (
  <button
    onClick={onClick}
    onContextMenu={onContextMenu}
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
