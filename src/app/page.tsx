'use client'

import { useEffect } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Editor } from '@/components/editor'
import {
  SearchModal,
  DeleteConfirmModal,
  ShortcutsModal,
  TemplatesModal,
  ExportModal
} from '@/components/modals'
import { useKeyboardShortcuts } from '@/hooks'
import { useUIStore, useNoteStore, useFolderStore } from '@/stores'

export default function Home() {
  const { sidebarCollapsed } = useUIStore()
  const { addNote } = useNoteStore()
  const { addFolder, activeFolderId } = useFolderStore()

  // Set up keyboard shortcuts
  useKeyboardShortcuts({
    onNewNote: () => addNote({ folderId: activeFolderId }),
    onNewFolder: () => addFolder(),
  })

  // Migrate old data on first load
  useEffect(() => {
    migrateOldData()
  }, [])

  return (
    <div className="flex h-screen w-screen bg-obsidianBlack text-obsidianText overflow-hidden">
      {/* Sidebar */}
      <div
        className={`flex-none transition-all duration-300 ${
          sidebarCollapsed ? 'w-[50px]' : 'w-64'
        }`}
      >
        <Sidebar />
      </div>

      {/* Editor */}
      <div
        className="flex-1 h-full overflow-hidden"
        style={{
          width: `calc(100vw - ${sidebarCollapsed ? '50px' : '16rem'})`
        }}
      >
        <Editor />
      </div>

      {/* Modals */}
      <SearchModal />
      <DeleteConfirmModal />
      <ShortcutsModal />
      <TemplatesModal />
      <ExportModal />
    </div>
  )
}

// Migrate data from old localStorage format
function migrateOldData() {
  try {
    // Check if old data exists
    const oldNotes = localStorage.getItem('notes')
    const oldFolders = localStorage.getItem('folders')
    const oldSidebarState = localStorage.getItem('sidebarCollapsed')

    // Check if new stores already have data
    const newNotesData = localStorage.getItem('noteser-notes')
    const newFoldersData = localStorage.getItem('noteser-folders')

    if (oldNotes && !newNotesData) {
      // Parse old notes
      const notes = JSON.parse(oldNotes)
      if (Array.isArray(notes) && notes.length > 0) {
        // Convert to new format
        const migratedNotes = notes.map((note: { id: number | string; title?: string; content?: string; folderId?: number | string | null }) => ({
          id: String(note.id),
          title: note.title || 'Untitled Note',
          content: note.content || '',
          folderId: note.folderId ? String(note.folderId) : null,
          tags: [],
          createdAt: typeof note.id === 'number' ? note.id : Date.now(),
          updatedAt: Date.now(),
          isDeleted: false,
          deletedAt: null,
          isPinned: false,
          templateId: null
        }))

        // Store in new format
        localStorage.setItem('noteser-notes', JSON.stringify({
          state: { notes: migratedNotes, selectedNoteId: null },
          version: 2
        }))

        // Remove old data
        localStorage.removeItem('notes')
      }
    }

    if (oldFolders && !newFoldersData) {
      const folders = JSON.parse(oldFolders)
      if (Array.isArray(folders) && folders.length > 0) {
        const migratedFolders = folders.map((folder: { id: number | string; name?: string }, index: number) => ({
          id: String(folder.id),
          name: folder.name || 'Folder',
          parentId: null,
          createdAt: typeof folder.id === 'number' ? folder.id : Date.now(),
          updatedAt: Date.now(),
          isDeleted: false,
          deletedAt: null,
          order: index
        }))

        localStorage.setItem('noteser-folders', JSON.stringify({
          state: { folders: migratedFolders, activeFolderId: null, expandedFolders: {} },
          version: 2
        }))

        localStorage.removeItem('folders')
      }
    }

    if (oldSidebarState) {
      localStorage.removeItem('sidebarCollapsed')
    }
  } catch (error) {
    console.error('Migration error:', error)
  }
}
