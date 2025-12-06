'use client'

import { useEffect, useRef } from 'react'
import {
  TrashIcon,
  DocumentDuplicateIcon,
  FolderArrowDownIcon,
  StarIcon,
  PencilIcon,
  ArrowUturnLeftIcon
} from '@heroicons/react/24/outline'
import { useNoteStore, useFolderStore, useUIStore } from '@/stores'
import type { ContextMenuState } from '@/types'

interface ContextMenuProps {
  contextMenu: NonNullable<ContextMenuState>
  onClose: () => void
}

export const ContextMenu = ({ contextMenu, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const { openModal } = useUIStore()
  const {
    getNoteById,
    duplicateNote,
    togglePinNote,
    deleteNote
  } = useNoteStore()
  const { getFolderById, deleteFolder, getActiveFolders } = useFolderStore()

  const isNote = contextMenu.type === 'note'
  const item = isNote
    ? getNoteById(contextMenu.id)
    : getFolderById(contextMenu.id)

  const folders = getActiveFolders()

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
      {isNote && (
        <>
          <MenuButton
            icon={(item as { isPinned?: boolean }).isPinned ? StarIcon : StarIcon}
            label={(item as { isPinned?: boolean }).isPinned ? 'Unpin' : 'Pin to top'}
            onClick={handleTogglePin}
          />
          <MenuButton
            icon={DocumentDuplicateIcon}
            label="Duplicate"
            onClick={handleDuplicate}
          />

          {/* Move to folder submenu */}
          {folders.length > 0 && (
            <div className="relative group">
              <button className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight">
                <span className="flex items-center gap-2">
                  <FolderArrowDownIcon className="w-4 h-4" />
                  Move to folder
                </span>
                <span className="text-obsidianSecondaryText">▶</span>
              </button>
              <div className="absolute left-full top-0 ml-1 bg-obsidianGray border border-obsidianBorder rounded-lg shadow-obsidian py-1 min-w-[150px] hidden group-hover:block">
                <button
                  onClick={() => handleMoveToFolder(null)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
                >
                  No folder
                </button>
                {folders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => handleMoveToFolder(folder.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-obsidianText hover:bg-obsidianHighlight"
                  >
                    {folder.name}
                  </button>
                ))}
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
