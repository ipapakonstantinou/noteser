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
  TaskEditModal,
  CommandPalette,
} from '@/components/modals'
import { useKeyboardShortcuts, useHydration, useAutoSync } from '@/hooks'
import { useUIStore, useWorkspaceStore, useGitHubStore } from '@/stores'
import { switchVault } from '@/utils/switchVault'
import { notesKey } from '@/utils/repoStorage'
import { useNoteStore } from '@/stores/noteStore'
import { STORAGE_KEYS } from '@/utils/storageKeys'
import { installTestHooks } from '@/utils/testHooks'
import {
  wipeNoteserState,
  isResetRequestedFromURL,
  readStoredResetVersion,
  writeStoredResetVersion,
  decideResetAction,
  PERSISTED_RESET_VERSION,
} from '@/utils/reset'

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

  // After hydration + prune, if there are still no open tabs, restore
  // *something* useful so the user lands on a note instead of "No note
  // selected." Preference order:
  //   1. The previously-active note (`selectedNoteId`) if it still
  //      exists and isn't soft-deleted.
  //   2. The most-recently-updated non-deleted note as a fallback —
  //      covers the case where the previously-selected note got purged
  //      (trash, sync, etc.) since the last session.
  useEffect(() => {
    if (!hydrated) return
    const ws = useWorkspaceStore.getState()
    const hasOpenTabs = ws.panes.some(p => p.tabs.length > 0)
    if (hasOpenTabs) return
    const { notes, selectedNoteId } = useNoteStore.getState()
    const activeNotes = notes.filter(n => !n.isDeleted)
    if (activeNotes.length === 0) return

    let target: typeof activeNotes[number] | undefined
    if (selectedNoteId) {
      target = activeNotes.find(n => n.id === selectedNoteId)
    }
    if (!target) {
      // Pick the most-recently-updated note as a fallback.
      target = activeNotes.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]
    }
    if (target) ws.openNote(target.id, { preview: false })
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

  // Auto-sync on startup + on the configured interval (Settings → GitHub).
  useAutoSync()

  // Migrate old data on first load
  useEffect(() => {
    migrateOldData()
  }, [])

  // Recovery: `?reset=1` URL flag wipes all noteser-* storage + IDB then
  // reloads cleanly. Use when state has drifted out of sync with the
  // remote and the user wants to start fresh. Runs once on mount, before
  // hydration — so a wipe doesn't race with a half-loaded store.
  useEffect(() => {
    if (!isResetRequestedFromURL()) return
    void (async () => {
      await wipeNoteserState()
      // Strip the ?reset=1 from the URL so a refresh doesn't loop the wipe.
      window.location.replace(window.location.pathname)
    })()
  }, [])

  // Kill-switch: bump PERSISTED_RESET_VERSION in code to force every browser
  // to wipe once on next visit. Runs after hydration so we can safely check
  // unsynced-changes state. Confirms with the user when there's local-only
  // work; wipes silently otherwise. Writes the new version after wipe so
  // subsequent reloads don't repeat the prompt.
  useEffect(() => {
    if (!hydrated) return
    const stored = readStoredResetVersion()
    const decision = decideResetAction({
      storedVersion: stored,
      currentVersion: PERSISTED_RESET_VERSION,
      notes: useNoteStore.getState().notes,
      lastSyncedAt: useGitHubStore.getState().lastSyncedAt,
    })
    if (decision.action === 'noop') return
    void (async () => {
      if (decision.action === 'confirm') {
        const ok = window.confirm(
          'Noteser needs to reset local cache to fix a sync bug. You have ' +
          'unsynced local changes that will be lost. Export first or sync now? ' +
          'Click Cancel to keep your local state and skip this update.',
        )
        if (!ok) {
          // User declined — DON'T write the new version, so we ask again
          // next reload. They can /export, sync, and reload to clear.
          return
        }
      }
      await wipeNoteserState()
      writeStoredResetVersion(PERSISTED_RESET_VERSION)
      window.location.reload()
    })()
  }, [hydrated])

  // Expose stores + attachment helpers on window for Playwright tests.
  // Side-effect-only, no UI impact.
  useEffect(() => {
    installTestHooks()
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
      <TaskEditModal />
      <CommandPalette />
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
