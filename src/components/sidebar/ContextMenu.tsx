'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  TrashIcon,
  DocumentDuplicateIcon,
  FolderArrowDownIcon,
  FolderPlusIcon,
  DocumentPlusIcon,
  PencilSquareIcon,
  StarIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
} from '@heroicons/react/24/outline'
import { useNoteStore, useFolderStore, useUIStore, useWorkspaceStore } from '@/stores'
import type { ContextMenuState, Folder } from '@/types'

// Build a flat list of folders annotated with their full path
// ("Parent / Child / Leaf"), in tree order.
function flattenFolders(folders: Folder[]): Array<{ id: string; path: string }> {
  const byParent = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const key = f.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(f)
  }
  for (const [, kids] of byParent) kids.sort((a, b) => a.order - b.order)

  const out: Array<{ id: string; path: string }> = []
  const walk = (parentId: string | null, prefix: string) => {
    const kids = byParent.get(parentId) ?? []
    for (const f of kids) {
      const path = prefix ? `${prefix} / ${f.name}` : f.name
      out.push({ id: f.id, path })
      walk(f.id, path)
    }
  }
  walk(null, '')
  return out
}

interface ContextMenuProps {
  contextMenu: NonNullable<ContextMenuState>
  onClose: () => void
}

export const ContextMenu = ({ contextMenu, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const { openModal } = useUIStore()
  const requestRename = useUIStore(s => s.requestRename)
  const {
    getNoteById,
    addNote,
    duplicateNote,
    togglePinNote,
    deleteNote
  } = useNoteStore()
  const { getFolderById, addFolder, deleteFolder, getActiveFolders, toggleFolderExpanded, expandedFolders } = useFolderStore()
  const openNote = useWorkspaceStore(s => s.openNote)

  const isNote = contextMenu.type === 'note'
  const item = isNote
    ? getNoteById(contextMenu.id)
    : getFolderById(contextMenu.id)

  const folders = getActiveFolders()
  const folderPaths = useMemo(() => flattenFolders(folders), [folders])

  // Submenu state for "Move to folder" — click-toggle, not CSS hover.
  const [movePanelOpen, setMovePanelOpen] = useState(false)
  const [moveSearch, setMoveSearch] = useState('')
  const filteredFolderPaths = useMemo(() => {
    const q = moveSearch.trim().toLowerCase()
    if (!q) return folderPaths
    return folderPaths.filter(f => f.path.toLowerCase().includes(q))
  }, [folderPaths, moveSearch])

  // When the menu re-anchors (different right-click), close any open submenu.
  useEffect(() => {
    setMovePanelOpen(false)
    setMoveSearch('')
  }, [contextMenu])

  // Position menu to stay within viewport
  useEffect(() => {
    if (!menuRef.current) return

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()

    // Adjust if menu goes off right edge
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`
    }

    // Adjust if menu goes off bottom edge
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 10}px`
    }
  }, [contextMenu])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  if (!item) return null

  const handleDelete = () => {
    openModal({
      type: 'delete',
      data: { type: contextMenu.type, id: contextMenu.id }
    })
    onClose()
  }

  const handleDuplicate = () => {
    if (isNote) {
      duplicateNote(contextMenu.id)
    }
    onClose()
  }

  const handleTogglePin = () => {
    if (isNote) {
      togglePinNote(contextMenu.id)
    }
    onClose()
  }

  const handleMoveToFolder = (folderId: string | null) => {
    if (isNote) {
      const { moveNoteToFolder } = useNoteStore.getState()
      moveNoteToFolder(contextMenu.id, folderId)
    }
    onClose()
  }

  const handleNewSubfolder = () => {
    if (!isNote) {
      addFolder({ parentId: contextMenu.id })
      // Make sure the parent is expanded so the user sees the new child.
      if (!expandedFolders[contextMenu.id]) toggleFolderExpanded(contextMenu.id)
    }
    onClose()
  }

  const handleRename = () => {
    requestRename({ type: contextMenu.type as 'note' | 'folder', id: contextMenu.id })
    onClose()
  }

  const handleNewNoteInFolder = () => {
    if (!isNote) {
      const note = addNote({ folderId: contextMenu.id })
      openNote(note.id)
      if (!expandedFolders[contextMenu.id]) toggleFolderExpanded(contextMenu.id)
    }
    onClose()
  }

  const MenuButton = ({
    icon: Icon,
    label,
    onClick,
    danger = false
  }: {
    icon: typeof TrashIcon
    label: string
    onClick: () => void
    danger?: boolean
  }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-900/30'
          : 'text-obsidianText hover:bg-obsidianHighlight'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )

  return (
    <div
      ref={menuRef}
      className="fixed bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[180px] z-50"
      style={{
        top: contextMenu.y,
        left: contextMenu.x
      }}
    >
      {!isNote && (
        <>
          <MenuButton
            icon={DocumentPlusIcon}
            label="New note in folder"
            onClick={handleNewNoteInFolder}
          />
          <MenuButton
            icon={FolderPlusIcon}
            label="New subfolder"
            onClick={handleNewSubfolder}
          />
          <MenuButton
            icon={PencilSquareIcon}
            label="Rename"
            onClick={handleRename}
          />
          <div className="my-1 border-t border-obsidianBorder" />
        </>
      )}

      {isNote && (
        <>
          <MenuButton
            icon={(item as { isPinned?: boolean }).isPinned ? StarIcon : StarIcon}
            label={(item as { isPinned?: boolean }).isPinned ? 'Unpin' : 'Pin to top'}
            onClick={handleTogglePin}
          />
          <MenuButton
            icon={PencilSquareIcon}
            label="Rename"
            onClick={handleRename}
          />
          <MenuButton
            icon={DocumentDuplicateIcon}
            label="Duplicate"
            onClick={handleDuplicate}
          />

          {!movePanelOpen && (
            <button
              onClick={() => setMovePanelOpen(true)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
            >
              <span className="flex items-center gap-2">
                <FolderArrowDownIcon className="w-4 h-4" />
                Move to folder
              </span>
              <ChevronRightIcon className="w-4 h-4 text-obsidianSecondaryText" />
            </button>
          )}

          {movePanelOpen && (
            <div className="w-full">
              <button
                onClick={() => setMovePanelOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-obsidianSecondaryText hover:bg-obsidianHighlight"
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                Back
              </button>
              <input
                type="text"
                value={moveSearch}
                onChange={e => setMoveSearch(e.target.value)}
                placeholder="Filter folders…"
                autoFocus
                className="w-[calc(100%-1.5rem)] mx-3 my-1 px-2 py-1 bg-obsidianDarkGray border border-obsidianBorder rounded text-xs text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
              />
              <div className="max-h-60 overflow-y-auto">
                <button
                  onClick={() => handleMoveToFolder(null)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-obsidianText hover:bg-obsidianHighlight"
                >
                  <span className="text-obsidianSecondaryText italic">— No folder (root) —</span>
                </button>
                {filteredFolderPaths.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-obsidianSecondaryText italic">No matches</div>
                ) : (
                  filteredFolderPaths.map(({ id, path }) => (
                    <button
                      key={id}
                      onClick={() => handleMoveToFolder(id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-obsidianText hover:bg-obsidianHighlight text-left truncate"
                      title={path}
                    >
                      {path}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="my-1 border-t border-obsidianBorder" />

        </>
      )}

      <MenuButton
        icon={TrashIcon}
        label="Delete"
        onClick={handleDelete}
        danger
      />
    </div>
  )
}

export default ContextMenu
