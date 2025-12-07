'use client'

import { useState } from 'react'
import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  PlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ClockIcon,
  TagIcon,
  DocumentDuplicateIcon,
  Cog6ToothIcon
} from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore, useFolderStore } from '@/stores'
import { useHydration } from '@/hooks'
import { FolderTree } from './FolderTree'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuState } from '@/types'

export const Sidebar = () => {
  const hydrated = useHydration()
  const {
    sidebarCollapsed,
    toggleSidebar,
    currentView,
    setCurrentView,
    openSearch,
    openModal
  } = useUIStore()

  const { addNote, getDeletedNotes, getRecentNotes, getPinnedNotes } = useNoteStore()
  const { addFolder, activeFolderId } = useFolderStore()

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  // Use default values during SSR/hydration to avoid mismatch
  const deletedNotes = hydrated ? getDeletedNotes() : []
  const recentNotes = hydrated ? getRecentNotes(5) : []
  const pinnedNotes = hydrated ? getPinnedNotes() : []

  const handleAddNote = () => {
    addNote({ folderId: activeFolderId })
  }

  const handleAddFolder = () => {
    addFolder()
  }

  const handleRightClick = (e: React.MouseEvent, type: 'note' | 'folder', id: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type, id })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  return (
    <div
      className={`obsidian-sidebar h-full overflow-hidden flex flex-col transition-all duration-300 ${
        sidebarCollapsed ? 'w-[50px]' : 'w-64'
      }`}
      onClick={closeContextMenu}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-obsidianBorder">
        {!sidebarCollapsed && (
          <h1 className="text-lg font-semibold text-obsidianText">Noteser</h1>
        )}
        <button
          className="obsidian-button"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronDoubleRightIcon className="w-4 h-4" />
          ) : (
            <ChevronDoubleLeftIcon className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-obsidianBorder">
        {sidebarCollapsed ? (
          <button
            className="obsidian-button w-full"
            onClick={handleAddNote}
            title="New note"
          >
            <PlusIcon className="w-5 h-5" />
          </button>
        ) : (
          <>
            <button
              className="obsidian-button flex-1 flex items-center justify-center gap-1"
              onClick={openSearch}
              title="Search (Ctrl+K)"
            >
              <MagnifyingGlassIcon className="w-4 h-4" />
              <span className="text-xs">Search</span>
            </button>
            <button
              className="obsidian-button"
              onClick={handleAddNote}
              title="New note (Ctrl+N)"
            >
              <PlusIcon className="w-5 h-5" />
            </button>
            <button
              className="obsidian-button"
              onClick={handleAddFolder}
              title="New folder (Ctrl+Shift+N)"
            >
              <FolderPlusIcon className="w-5 h-5" />
            </button>
            <button
              className="obsidian-button"
              onClick={() => openModal({ type: 'template' })}
              title="New from template"
            >
              <DocumentDuplicateIcon className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      {!sidebarCollapsed && (
        <div className="px-2 py-2 border-b border-obsidianBorder space-y-1">
          <button
            onClick={() => setCurrentView('notes')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'notes'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <DocumentDuplicateIcon className="w-4 h-4" />
            All Notes
          </button>
          <button
            onClick={() => setCurrentView('recent')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'recent'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <ClockIcon className="w-4 h-4" />
            Recent
            {recentNotes.length > 0 && (
              <span className="ml-auto text-xs text-obsidianSecondaryText">
                {recentNotes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setCurrentView('tags')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'tags'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <TagIcon className="w-4 h-4" />
            Tags
          </button>
          <button
            onClick={() => setCurrentView('trash')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'trash'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <TrashIcon className="w-4 h-4" />
            Trash
            {deletedNotes.length > 0 && (
              <span className="ml-auto text-xs text-obsidianSecondaryText">
                {deletedNotes.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!sidebarCollapsed && (
          <FolderTree onRightClick={handleRightClick} />
        )}
      </div>

      {/* Footer */}
      {!sidebarCollapsed && (
        <div className="px-2 py-2 border-t border-obsidianBorder">
          <button
            onClick={() => openModal({ type: 'export' })}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-obsidianSecondaryText hover:bg-obsidianDarkGray transition-colors"
          >
            <Cog6ToothIcon className="w-4 h-4" />
            Export Notes
          </button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          contextMenu={contextMenu}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}

export default Sidebar
