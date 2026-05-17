'use client'

import { useState } from 'react'
import { DocumentTextIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'
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
  const notes = useNoteStore(s => s.notes)

  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  if (pane.tabs.length === 0) return null

  const paneIsActive = pane.id === activePaneId

  const onDragStart = (e: React.DragEvent, tabId: string) => {
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
        paneIsActive ? 'bg-obsidianGray' : 'bg-obsidianGray/60'
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
              onClick={() => focusTab(tab.id)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border-r border-obsidianBorder cursor-pointer max-w-[200px] flex-shrink-0 select-none ${
                active
                  ? 'bg-obsidianBlack text-obsidianText border-t-2 border-t-obsidianAccentPurple'
                  : 'text-obsidianSecondaryText hover:bg-obsidianHighlight'
              }`}
              title={title.tooltip}
            >
              {tab.kind === 'merge-conflict'
                ? <ExclamationTriangleIcon className="w-4 h-4 text-amber-400 flex-shrink-0" />
                : <DocumentTextIcon className="w-4 h-4 flex-shrink-0" />}
              <span className={`truncate flex-1 min-w-0 ${title.italic ? 'italic' : ''}`}>{title.text}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                className="flex-shrink-0 p-0.5 rounded hover:bg-obsidianHighlight text-obsidianSecondaryText"
                title="Close tab"
                aria-label="Close tab"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
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
  const note = notes.find(n => n.id === tab.noteId)
  const text = note?.title || 'Untitled'
  return { text, tooltip: text, italic: tab.isPreview }
}

export default TabBar
