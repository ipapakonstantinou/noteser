'use client'

import { useEffect, useRef, useState } from 'react'
import {
  DocumentTextIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  SparklesIcon,
  ArrowsRightLeftIcon,
  ArrowsUpDownIcon,
} from '@heroicons/react/24/outline'
import { useNoteStore, useWorkspaceStore } from '@/stores'
import { TAB_DRAG_MIME } from '@/hooks'
import type { Tab, PaneState } from '@/stores/workspaceStore'

interface RenderedTitle { text: string; tooltip: string; italic: boolean }
interface Props { pane: PaneState }

// Tab strip for a single pane. Tabs are draggable; dropping between tabs
// reorders or moves across panes.
export const TabBar = ({ pane }: Props) => {
  const activeTabId = pane.activeTabId
  const activePaneId = useWorkspaceStore(s => s.activePaneId)
  const focusTab = useWorkspaceStore(s => s.focusTab)
  const closeTab = useWorkspaceStore(s => s.closeTab)
  const moveTab = useWorkspaceStore(s => s.moveTab)
  const promoteTab = useWorkspaceStore(s => s.promoteTab)
  const splitTabRight = useWorkspaceStore(s => s.splitTabRight)
  const splitTabDown = useWorkspaceStore(s => s.splitTabDown)
  const paneCount = useWorkspaceStore(s => s.panes.length)
  const notes = useNoteStore(s => s.notes)
  const canSplitMore = paneCount < 3

  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  // Close on click-out / Esc — mirrors the sidebar ContextMenu pattern.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-testid="tab-context-menu"]')) return
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  // A genuine (slightly slow) double-click does not reliably fire the native
  // dblclick event, so self-detect two clicks on the same tab within 350ms and
  // pin it (VS Code: double-click a preview tab to keep it). onDoubleClick is
  // kept as a redundant fast path.
  const lastTabClick = useRef<{ id: string; t: number }>({ id: '', t: 0 })
  const handleTabClick = (tabId: string) => {
    const now = Date.now()
    if (lastTabClick.current.id === tabId && now - lastTabClick.current.t < 350) {
      lastTabClick.current = { id: '', t: 0 }
      promoteTab(tabId)
    } else {
      lastTabClick.current = { id: tabId, t: now }
      focusTab(tabId)
    }
  }

  if (pane.tabs.length === 0) return null

  const paneIsActive = pane.id === activePaneId

  const onDragStart = (e: React.DragEvent, tabId: string) => {
    // Primary-button guard — see useTreeDragDrop for the full reasoning.
    if (e.nativeEvent && e.nativeEvent.button !== 0) return
    e.dataTransfer.setData(TAB_DRAG_MIME, tabId)
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragEnd = () => setDragOverIdx(null)

  // Drop on a gap between tabs (insertion).
  const handleGapDragOver = (e: React.DragEvent, idx: number) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIdx !== idx) setDragOverIdx(idx)
  }
  const handleGapDrop = (e: React.DragEvent, idx: number) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    const tabId = e.dataTransfer.getData(TAB_DRAG_MIME)
    if (tabId) moveTab(tabId, pane.id, idx)
    setDragOverIdx(null)
  }

  // The gaps between tabs are only a few px wide — far too narrow to land a
  // drop on reliably, which is why reordering "didn't work". So make each TAB
  // a drop target too: insert before it when the pointer is on its left half,
  // after it on the right half. moveTab handles the same-pane index shift.
  const tabInsertIdx = (e: React.DragEvent, i: number) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientX < rect.left + rect.width / 2 ? i : i + 1
  }
  const handleTabDragOver = (e: React.DragEvent, i: number) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const idx = tabInsertIdx(e, i)
    if (dragOverIdx !== idx) setDragOverIdx(idx)
  }
  const handleTabDrop = (e: React.DragEvent, i: number) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    const tabId = e.dataTransfer.getData(TAB_DRAG_MIME)
    if (tabId) moveTab(tabId, pane.id, tabInsertIdx(e, i))
    setDragOverIdx(null)
  }

  return (
    <>
    <div
      role="tablist"
      aria-label="Editor tabs"
      className={`flex items-stretch border-b overflow-x-auto transition-colors ${
        paneIsActive
          ? 'bg-obsidianBlack border-b-obsidianAccentPurple/60'
          : 'bg-obsidianBlack/95 border-b-obsidianBorder'
      }`}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOverIdx(null) }}
    >
      {/* Leading gap (insert at idx 0) */}
      <DropGap
        idx={0}
        showLine={dragOverIdx === 0}
        onDragOver={handleGapDragOver}
        onDrop={handleGapDrop}
      />

      {pane.tabs.map((tab, i) => {
        const title = renderTitle(tab, notes)
        const active = tab.id === activeTabId
        return (
          <div key={tab.id} className="flex items-stretch">
            <div
              draggable
              onDragStart={(e) => onDragStart(e, tab.id)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => handleTabDragOver(e, i)}
              onDrop={(e) => handleTabDrop(e, i)}
              onClick={() => handleTabClick(tab.id)}
              onDoubleClick={() => promoteTab(tab.id)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
              }}
              role="tab"
              id={`editor-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`editor-tabpanel-${pane.id}`}
              tabIndex={active ? 0 : -1}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-r border-obsidianBorder cursor-pointer max-w-[200px] shrink-0 select-none min-h-[44px] ${
                active
                  ? 'bg-obsidianBlack text-obsidianText border-t-2 border-t-obsidianAccentPurple'
                  : 'text-obsidianSecondaryText hover:bg-obsidianHighlight'
              }`}
              title={title.tooltip}
            >
              {tab.kind === 'merge-conflict' || tab.kind === 'merge-batch'
                ? <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 shrink-0" />
                : tab.kind === 'welcome'
                  ? <SparklesIcon className="w-4 h-4 text-obsidianAccentPurple shrink-0" />
                  : tab.kind === 'compare'
                    ? <DocumentDuplicateIcon className="w-4 h-4 text-obsidianAccentPurple shrink-0" />
                    : <DocumentTextIcon className="w-4 h-4 shrink-0" />}
              <span className={`truncate flex-1 min-w-0 ${title.italic ? 'italic' : ''}`}>{title.text}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                className="shrink-0 p-0.5 max-md:p-2 rounded-sm hover:bg-obsidianHighlight text-obsidianSecondaryText inline-flex items-center justify-center max-md:min-w-[36px] max-md:min-h-[36px]"
                title="Close tab"
                aria-label="Close tab"
              >
                <XMarkIcon className="w-3.5 h-3.5 max-md:w-4 max-md:h-4" />
              </button>
            </div>
            <DropGap
              idx={i + 1}
              showLine={dragOverIdx === i + 1}
              onDragOver={handleGapDragOver}
              onDrop={handleGapDrop}
            />
          </div>
        )
      })}
    </div>
    {menu && (
      <TabContextMenu
        x={menu.x}
        y={menu.y}
        canSplit={canSplitMore}
        onSplitRight={() => { splitTabRight(menu.tabId); setMenu(null) }}
        onSplitDown={() => { splitTabDown(menu.tabId); setMenu(null) }}
        onClose={() => { closeTab(menu.tabId); setMenu(null) }}
      />
    )}
    </>
  )
}

interface TabContextMenuProps {
  x: number
  y: number
  canSplit: boolean
  onSplitRight: () => void
  onSplitDown: () => void
  onClose: () => void
}

const TabContextMenu = ({ x, y, canSplit, onSplitRight, onSplitDown, onClose }: TabContextMenuProps) => {
  const ref = useRef<HTMLDivElement>(null)
  // Nudge the menu back into view if it would render off the right/bottom
  // edge — matches the sidebar ContextMenu adjustment.
  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`
    }
  }, [])

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="tab-context-menu"
      className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[180px] z-50"
      style={{ top: y, left: x }}
    >
      <button
        onClick={onSplitRight}
        disabled={!canSplit}
        data-testid="tab-context-split-right"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowsRightLeftIcon className="w-4 h-4" />
        Split right
      </button>
      <button
        onClick={onSplitDown}
        disabled={!canSplit}
        data-testid="tab-context-split-down"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowsUpDownIcon className="w-4 h-4" />
        Split down
      </button>
      <div className="my-1 border-t border-obsidianBorder" />
      <button
        onClick={onClose}
        data-testid="tab-context-close"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight transition-colors"
      >
        <XMarkIcon className="w-4 h-4" />
        Close tab
      </button>
    </div>
  )
}

const DropGap = ({ idx, showLine, onDragOver, onDrop }: {
  idx: number
  showLine: boolean
  onDragOver: (e: React.DragEvent, idx: number) => void
  onDrop: (e: React.DragEvent, idx: number) => void
}) => (
  <div
    onDragOver={(e) => onDragOver(e, idx)}
    onDrop={(e) => onDrop(e, idx)}
    className="relative w-1 shrink-0"
  >
    {showLine && (
      <div className="absolute inset-y-0 left-0 w-0.5 bg-obsidianAccentPurple" />
    )}
  </div>
)

function renderTitle(tab: Tab, notes: Array<{ id: string; title: string }>): RenderedTitle {
  if (tab.kind === 'merge-conflict') {
    const path = tab.conflict.path
    return { text: path, tooltip: `Merge conflict — ${path}`, italic: false }
  }
  if (tab.kind === 'merge-batch') {
    const n = tab.conflicts.length
    return { text: `Conflicts (${n})`, tooltip: `${n} conflict${n === 1 ? '' : 's'} from the last pull`, italic: false }
  }
  if (tab.kind === 'welcome') {
    return { text: 'Welcome', tooltip: 'Welcome — getting started', italic: false }
  }
  if (tab.kind === 'compare') {
    const leftNote = notes.find(n => n.id === tab.leftNoteId)
    const rightNote = notes.find(n => n.id === tab.rightNoteId)
    const leftTitle = leftNote?.title || 'Untitled'
    const rightTitle = rightNote?.title || 'Untitled'
    const text = `${leftTitle} ↔ ${rightTitle}`
    return { text, tooltip: `Compare: ${leftTitle} ↔ ${rightTitle}`, italic: false }
  }
  const note = notes.find(n => n.id === tab.noteId)
  const text = note?.title || 'Untitled'
  return { text, tooltip: text, italic: tab.isPreview }
}

export default TabBar
