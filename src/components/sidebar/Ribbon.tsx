'use client'

import { useMemo, useRef, useState } from 'react'
import {
  MagnifyingGlassIcon,
  DocumentDuplicateIcon,
  ClockIcon,
  TagIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore, useSettingsStore } from '@/stores'
import { useHydration } from '@/hooks'

// Obsidian-style far-left ribbon. Always visible. Holds Search + nav icons
// (All Notes, Recent, Tags, Trash, Calendar) plus a Settings gear pinned
// to the bottom. Clicking a nav icon switches the sidebar's content area
// to that view.
//
// The nav items are user-reorderable via drag-and-drop. Order persists in
// `useSettingsStore.ribbonOrder`. Items not yet in the saved order (e.g.
// when a future release adds a new nav target) are appended at the end so
// new features don't get hidden by an old saved order.

// Filter-mode views still surfaced from the ribbon. Used as the
// `currentView` value when an ItemDef is clicked — FolderTree reads
// currentView to decide what slice of notes to render. Older saved
// ribbonOrder entries referencing the removed items (calendar,
// outline, github, backlinks, trash) are silently dropped by
// resolveRibbonOrder, so no migration is needed.
type ItemView =
  | 'notes' | 'recent' | 'tags'

interface ItemDef {
  id: ItemView
  Icon: typeof DocumentDuplicateIcon
  title: (ctx: BadgeCtx) => string
  badgeRed?: (ctx: BadgeCtx) => boolean
  /** If false, the item is hidden entirely (e.g. GitHub before connect). */
  visible?: (ctx: BadgeCtx) => boolean
}

interface BadgeCtx {
  recentCount: number
}

// Ribbon items kept after the great de-dup of 2026-05-20. We removed
// `calendar` (pinned section above the strip), `outline`, `backlinks`
// (folded into outline tab pending its own home), and `github` —
// every one of those has a dedicated SidebarStack tab now, so a
// second click target on the ribbon was pure duplication. `trash` is
// also gone: the upcoming `.trash` folder model (task 103) will
// surface deleted notes in the regular folder tree.
// Remaining items are filter modes for the Files tab (notes / recent
// / tags), since those don't have tabs of their own.
const ITEMS: readonly ItemDef[] = [
  { id: 'notes',  Icon: DocumentDuplicateIcon, title: () => 'All notes' },
  { id: 'recent', Icon: ClockIcon, title: c => `Recent${c.recentCount ? ` (${c.recentCount})` : ''}` },
  { id: 'tags',   Icon: TagIcon, title: () => 'Tags' },
]

// Merge the user's saved order with the source order, dropping ids that
// no longer exist and appending any new ids. Pure function — easy to test.
export function resolveRibbonOrder(saved: string[]): ItemView[] {
  const known = new Set(ITEMS.map(i => i.id))
  const seen = new Set<string>()
  const out: ItemView[] = []
  for (const id of saved) {
    if (known.has(id as ItemView) && !seen.has(id)) {
      seen.add(id)
      out.push(id as ItemView)
    }
  }
  for (const item of ITEMS) {
    if (!seen.has(item.id)) out.push(item.id)
  }
  return out
}

const RIBBON_DRAG_MIME = 'application/x-noteser-ribbon-item'

// Ribbon de-dup (2026-05-20) means every ribbon item is a
// filter-mode view now. The tab-routing map is empty but kept as a
// hook for future ribbon-only entries that target a stack tab.
import type { SidebarTabId } from '@/stores'
const VIEW_TO_TAB_ID: Partial<Record<ItemView, SidebarTabId>> = {}

export const Ribbon = () => {
  const { openSearch, currentView, setCurrentView, openModal, setSidebarTab } = useUIStore()
  const { getRecentNotes } = useNoteStore()
  const ribbonOrder = useSettingsStore(s => s.ribbonOrder)
  const setRibbonOrder = useSettingsStore(s => s.setRibbonOrder)
  const hydrated = useHydration()

  const recentCount = hydrated ? getRecentNotes(99).length : 0

  // Memoise ctx so it doesn't tear the orderedItems memo on every render.
  // Each scalar dep is referentially stable, so this is cheap.
  const ctx: BadgeCtx = useMemo(
    () => ({ recentCount }),
    [recentCount],
  )

  const orderedIds = useMemo(() => resolveRibbonOrder(ribbonOrder), [ribbonOrder])
  const orderedItems = useMemo(() => {
    const byId = new Map(ITEMS.map(i => [i.id, i]))
    return orderedIds
      .map(id => byId.get(id))
      .filter((i): i is ItemDef => Boolean(i))
      .filter(item => item.visible == null || item.visible(ctx))
  }, [orderedIds, ctx])

  const [draggingId, setDraggingId] = useState<ItemView | null>(null)
  const [dropTargetId, setDropTargetId] = useState<ItemView | null>(null)
  const dropPos = useRef<'before' | 'after'>('before')

  const handleDragStart = (id: ItemView) => (e: React.DragEvent) => {
    e.dataTransfer.setData(RIBBON_DRAG_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(id)
  }

  const handleDragOver = (id: ItemView) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(RIBBON_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // Halfway-point detection: top half = drop ABOVE this item; bottom = below.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropPos.current = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after'
    setDropTargetId(id)
  }

  const handleDragLeave = () => {
    setDropTargetId(null)
  }

  const handleDrop = (targetId: ItemView) => (e: React.DragEvent) => {
    const droppedId = e.dataTransfer.getData(RIBBON_DRAG_MIME) as ItemView
    if (!droppedId || droppedId === targetId) {
      setDraggingId(null); setDropTargetId(null); return
    }
    e.preventDefault()
    // Recompute the next order: pull `droppedId` out, insert relative to target.
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
      <RibbonButton onClick={openSearch} title="Search (Ctrl+K)">
        <MagnifyingGlassIcon className="w-5 h-5" />
      </RibbonButton>

      {orderedItems.map(item => {
        const tabId = VIEW_TO_TAB_ID[item.id]
        // Items that target a SidebarStack tab don't carry the
        // After the ribbon de-dup, every remaining item is a
        // filter-mode view (notes/recent/tags). The active highlight
        // mirrors currentView; clicks route through setCurrentView.
        const active = !tabId && currentView === item.id
        const dragging = draggingId === item.id
        const isDropTarget = dropTargetId === item.id
        const Icon = item.Icon
        const badgeRed = item.badgeRed?.(ctx) ?? false
        const handleClick = () => {
          if (tabId) {
            setSidebarTab(tabId)
            return
          }
          setCurrentView(item.id)
        }
        return (
          <div
            key={item.id}
            data-testid={`ribbon-item-${item.id}`}
            draggable
            onDragStart={handleDragStart(item.id)}
            onDragOver={handleDragOver(item.id)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop(item.id)}
            onDragEnd={handleDragEnd}
            className={[
              'relative',
              dragging ? 'opacity-40' : '',
              isDropTarget && dropPos.current === 'before' ? 'border-t-2 border-obsidianAccentPurple -mt-[2px]' : '',
              isDropTarget && dropPos.current === 'after'  ? 'border-b-2 border-obsidianAccentPurple -mb-[2px]' : '',
            ].join(' ')}
          >
            <RibbonNavButton
              active={active}
              onClick={handleClick}
              title={item.title(ctx)}
            >
              {badgeRed ? (
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />
                </div>
              ) : (
                <Icon className="w-5 h-5" />
              )}
            </RibbonNavButton>
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

const RibbonButton = ({
  onClick, title, children,
}: { onClick: () => void; title: string; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    title={title}
    className="p-2 max-md:p-2.5 rounded text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText transition-colors inline-flex items-center justify-center max-md:min-w-[44px] max-md:min-h-[44px]"
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
    className={`p-2 max-md:p-2.5 rounded transition-colors inline-flex items-center justify-center max-md:min-w-[44px] max-md:min-h-[44px] ${
      active
        ? 'bg-obsidianHighlight text-obsidianText'
        : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText'
    }`}
  >
    {children}
  </button>
)

export default Ribbon
