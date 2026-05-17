'use client'

import { DocumentTextIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useWorkspaceStore } from '@/stores'
import type { Tab } from '@/stores/workspaceStore'

interface RenderedTitle { text: string; tooltip: string; italic: boolean }

// Tab strip at the top of the editor area. Currently single-row, no scroll
// (overflowing tabs truncate). Drag-reorder + middle-click close are nice
// follow-ups but not in this MVP.
export const TabBar = () => {
  const tabs = useWorkspaceStore(s => s.tabs)
  const activeTabId = useWorkspaceStore(s => s.activeTabId)
  const focusTab = useWorkspaceStore(s => s.focusTab)
  const closeTab = useWorkspaceStore(s => s.closeTab)
  const notes = useNoteStore(s => s.notes)

  if (tabs.length === 0) return null

  return (
    <div className="flex items-stretch border-b border-obsidianBorder bg-obsidianGray overflow-x-auto">
      {tabs.map((tab) => {
        const title = renderTitle(tab, notes)
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
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
        )
      })}
    </div>
  )
}

function renderTitle(tab: Tab, notes: Array<{ id: string; title: string }>): RenderedTitle {
  if (tab.kind === 'merge-conflict') {
    // Use the file path as the tab title — the conflict view IS that file.
    const path = tab.conflict.path
    return { text: path, tooltip: `Merge conflict — ${path}`, italic: false }
  }
  const note = notes.find(n => n.id === tab.noteId)
  const text = note?.title || 'Untitled'
  return { text, tooltip: text, italic: tab.isPreview }
}

export default TabBar
