'use client'

import { useEffect } from 'react'
import { Sidebar, Ribbon } from '@/components/sidebar'
import { Editor } from '@/components/editor'
import {
  SearchModal,
  DeleteConfirmModal,
  ShortcutsModal,
  TemplatesModal,
  SettingsModal,
  ExportModal,
  GitHubAuthModal,
  GitHubRepoModal,
} from '@/components/modals'
import { useKeyboardShortcuts, useHydration } from '@/hooks'
import { useUIStore, useWorkspaceStore, useGitHubStore } from '@/stores'
import { switchVault } from '@/utils/switchVault'
import { notesKey } from '@/utils/repoStorage'
import { useNoteStore } from '@/stores/noteStore'
import { STORAGE_KEYS } from '@/utils/storageKeys'

export default function Home() {
  const hydrated = useHydration()
  const { sidebarCollapsed } = useUIStore()
  const pruneStaleTabs = useWorkspaceStore(s => s.pruneStaleTabs)

  // Use default value during SSR to avoid hydration mismatch
  const isSidebarCollapsed = hydrated ? sidebarCollapsed : false

  // After hydration, drop any persisted tabs whose underlying notes are gone.
  useEffect(() => {
    if (hydrated) pruneStaleTabs()
  }, [hydrated, pruneStaleTabs])

  // After hydration + prune, if there are still no open tabs but we
  // remember a last-selected note, reopen it pinned. This makes startup
  // continue where the user left off even if they closed the tab before
  // reloading.
  useEffect(() => {
    if (!hydrated) return
    const ws = useWorkspaceStore.getState()
    const hasOpenTabs = ws.panes.some(p => p.tabs.length > 0)
    if (hasOpenTabs) return
    const selectedId = useNoteStore.getState().selectedNoteId
    if (!selectedId) return
    const note = useNoteStore.getState().notes.find(n => n.id === selectedId && !n.isDeleted)
    if (!note) return
    ws.openNote(selectedId, { preview: false })
  }, [hydrated])

  // After hydration, if a repo is connected but the stores are still pointed
  // at the unscoped default key (e.g. first run after upgrading to per-repo
  // vaults), move them to the scoped key so subsequent writes are isolated.
  useEffect(() => {
    if (!hydrated) return
    const repo = useGitHubStore.getState().syncRepo
    if (!repo) return
    const currentName = useNoteStore.persist.getOptions().name as string
    if (currentName === notesKey(repo)) return
    switchVault(repo, { carryOver: true }).catch(err => console.error('Vault scope migration failed', err))
  }, [hydrated])

  // Set up keyboard shortcuts
  useKeyboardShortcuts()

  // Migrate old data on first load
  useEffect(() => {
    migrateOldData()
  }, [])

  return (
    <div className="flex h-screen w-screen bg-obsidianBlack text-obsidianText overflow-hidden">
      {/* Ribbon */}
      <div className="flex-none">
        <Ribbon />
      </div>

      {/* Sidebar */}
      <div
        className={`flex-none transition-all duration-300 ${
          isSidebarCollapsed ? 'w-[50px]' : 'w-64'
        }`}
      >
        <Sidebar />
      </div>

      {/* Editor */}
      <div
        className="flex-1 h-full overflow-hidden"
        style={{
          width: `calc(100vw - 44px - ${isSidebarCollapsed ? '50px' : '16rem'})`
        }}
      >
        <Editor />
      </div>

      {/* Modals */}
      <SearchModal />
      <DeleteConfirmModal />
      <ShortcutsModal />
      <TemplatesModal />
      <SettingsModal />
      <ExportModal />
      <GitHubAuthModal />
      <GitHubRepoModal />
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
    const newNotesData = localStorage.getItem(STORAGE_KEYS.notes)
    const newFoldersData = localStorage.getItem(STORAGE_KEYS.folders)

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
        localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify({
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

        localStorage.setItem(STORAGE_KEYS.folders, JSON.stringify({
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
