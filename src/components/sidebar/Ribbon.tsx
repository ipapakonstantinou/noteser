'use client'

import { useMemo, useRef, useState } from 'react'
import {
  MagnifyingGlassIcon,
  DocumentPlusIcon,
  CalendarDaysIcon,
  CommandLineIcon,
  RectangleStackIcon,
  Cog6ToothIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useSettingsStore, useWorkspaceStore, useNoteStore } from '@/stores'

// Obsidian-style far-left ribbon. Permanent, always visible.
//
// Through May 2026 the ribbon held filter-mode icons (Notes / Recent /
// Tags) that re-filtered the already-visible Files panel. Telegram
// feedback flagged them as "not doing anything" — the visual change was
// too subtle. After this redesign the ribbon hosts quick-launch ACTIONS:
// each click opens or creates something concrete. The filter modes
// stayed in the store but are no longer surfaced from the ribbon — the
// FolderTreeToolbar / future view-picker is the right home for them.
//
// Items are user-reorderable via drag-and-drop. Order persists in
// `useSettingsStore.ribbonOrder`. Saved orders that reference the now-
// removed filter ids ('notes' / 'recent' / 'tags' / 'backlinks' /
// 'calendar' / etc.) are silently dropped by `resolveRibbonOrder` — no
// migration needed; the new ids get appended in source order.

// Action ids. Adding a new id requires extending this union AND adding
// an entry to `ITEMS` below. The ordering inside `ITEMS` is the default
// rendering order when the user has no saved customisation.
type ItemId =
  | 'new-note'
  | 'daily-note'
  | 'command-palette'
  | 'templates'
  | 'random-note'

interface ItemDef {
  id: ItemId
  Icon: typeof DocumentPlusIcon
  title: string
  // Fired on click. Pulls from store getState() inside the action to
  // avoid prop drilling — the ribbon doesn't need to re-render when
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
      // Lazy import keeps the ribbon free of a hard daily-notes
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
  {
    id: 'random-note',
    Icon: SparklesIcon,
    title: 'Open a random note (Alt+R)',
    action: () => {
      void import('@/utils/randomNote').then(({ openRandomNote }) => openRandomNote())
    },
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
  const ribbonOrder = useSettingsStore(s => s.ribbonOrder)
  const setRibbonOrder = useSettingsStore(s => s.setRibbonOrder)

  const orderedIds = useMemo(() => resolveRibbonOrder(ribbonOrder), [ribbonOrder])
  const itemsById = useMemo(() => new Map(ITEMS.map(i => [i.id, i])), [])

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

  return (
    <div className="h-full w-[44px] max-md:w-12 flex flex-col items-center gap-1 py-2 bg-obsidianBlack border-r border-obsidianBorder">
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

export default Ribbon
