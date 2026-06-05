'use client'

import { useRef, useState } from 'react'
import { DocumentTextIcon, DocumentDuplicateIcon, ExclamationTriangleIcon, XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline'
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
  const notes = useNoteStore(s => s.notes)

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

  return (
    <div
      className={`flex items-stretch border-b border-obsidianBorder overflow-x-auto ${
        paneIsActive ? 'bg-obsidianBlack' : 'bg-obsidianBlack/95'
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
              onClick={() => handleTabClick(tab.id)}
              onDoubleClick={() => promoteTab(tab.id)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-r border-obsidianBorder cursor-pointer max-w-[200px] flex-shrink-0 select-none min-h-[44px] ${
                active
                  ? 'bg-obsidianBlack text-obsidianText border-t-2 border-t-obsidianAccentPurple'
                  : 'text-obsidianSecondaryText hover:bg-obsidianHighlight'
              }`}
              title={title.tooltip}
            >
              {tab.kind === 'merge-conflict' || tab.kind === 'merge-batch'
                ? <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 flex-shrink-0" />
                : tab.kind === 'welcome'
                  ? <SparklesIcon className="w-4 h-4 text-obsidianAccentPurple flex-shrink-0" />
                  : tab.kind === 'compare'
                    ? <DocumentDuplicateIcon className="w-4 h-4 text-obsidianAccentPurple flex-shrink-0" />
                    : <DocumentTextIcon className="w-4 h-4 flex-shrink-0" />}
              <span className={`truncate flex-1 min-w-0 ${title.italic ? 'italic' : ''}`}>{title.text}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                className="flex-shrink-0 p-0.5 max-md:p-2 rounded hover:bg-obsidianHighlight text-obsidianSecondaryText inline-flex items-center justify-center max-md:min-w-[36px] max-md:min-h-[36px]"
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
    className="relative w-1 flex-shrink-0"
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
