'use client'

import { useEffect, useState } from 'react'
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
  BugReportModal,
  AIResultModal,
  VaultSettingsConflictModal,
} from '@/components/modals'
import { useSettingsStore } from '@/stores/settingsStore'
import { useKeyboardShortcuts, useHydration, useAutoSync, useAutoEmbedNotes, useApplyTheme } from '@/hooks'
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
  hasUnsyncedChanges,
  PERSISTED_RESET_VERSION,
  PRESERVE_ON_KILLSWITCH,
} from '@/utils/reset'
import { ResetConfirmModal } from '@/components/modals/ResetConfirmModal'

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

  // Auto re-embed notes on save when AI embeddings are enabled (a1f7
  // phase B). No-ops when the feature is off; per-note 5s debounce.
  useAutoEmbedNotes()

  // Apply the user's theme overrides (th3m) — writes any non-default
  // colors to :root CSS variables so Tailwind utilities pick them up
  // live. No-op when themeOverrides is empty.
  useApplyTheme()

  // First-run onboarding: show the starter-vault picker only for genuine
  // first-run users — no notes, no GitHub configured, and the user hasn't
  // dismissed it before. The GitHub check is what makes the "?reset=1
  // mid-debug" case sane: a returning user who reset is mid-pull, not a
  // first-timer, so the modal would otherwise sit over their sync and
  // block clicks until they noticed it.
  //
  // Re-checks when notes arrive (e.g. async sync pull) so the modal
  // auto-dismisses the moment the user clearly isn't first-run.
  // First-run experience: open a "Welcome" tab in the workspace (VS
  // Code-style) rather than a popup. Idempotent — workspaceStore.openWelcome
  // focuses an existing welcome tab instead of stacking duplicates.
  // Closing the tab flips onboardingShown via workspaceStore.closeTab so
  // we don't reopen on the next session.
  const onboardingShown = useSettingsStore(s => s.onboardingShown)
  const githubToken = useGitHubStore(s => s.token)
  const noteCount = useNoteStore(s => s.notes.filter(n => !n.isDeleted).length)
  useEffect(() => {
    if (!hydrated) return
    if (onboardingShown) return
    // Has GitHub creds OR notes already? Not a first-run user — mark
    // dismissed so we don't show the welcome tab on subsequent loads.
    if (githubToken || noteCount > 0) {
      useSettingsStore.getState().setOnboardingShown(true)
      return
    }
    useWorkspaceStore.getState().openWelcome()
  }, [hydrated, onboardingShown, githubToken, noteCount])

  // Import-from-share: when the URL has `?import=<fragment>`, decode it
  // (same format as /share), prompt the user, and add the note to their
  // vault. Strips the param so a reload doesn't loop the prompt.
  useEffect(() => {
    if (!hydrated) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const importFrag = params.get('import')
    if (!importFrag) return
    void (async () => {
      const { decodeShareFragment } = await import('@/utils/shareLink')
      const decoded = decodeShareFragment(importFrag)
      if (!decoded) {
        alert('Couldn\'t import — the link is malformed or from an incompatible version.')
        window.history.replaceState({}, '', window.location.pathname)
        return
      }
      const ok = window.confirm(
        `Import "${decoded.title}" into your vault? A copy will be added to the root folder.`,
      )
      if (ok) {
        const created = useNoteStore.getState().addNote({
          title: decoded.title,
          folderId: null,
          content: decoded.content,
        })
        useWorkspaceStore.getState().openNote(created.id, { preview: false })
      }
      window.history.replaceState({}, '', window.location.pathname)
    })()
  }, [hydrated])

  // Migrate old data on first load
  useEffect(() => {
    migrateOldData()
  }, [])

  // Recovery: `?reset=1` URL flag wipes all noteser-* storage + IDB.
  // Strip the param FIRST (via history.replaceState — doesn't navigate),
  // then run the async wipe, then reload cleanly. The previous order
  // meant a user reload mid-wipe re-fired the handler indefinitely
  // because `?reset=1` was still in the URL until the async finished.
  useEffect(() => {
    if (!isResetRequestedFromURL()) return
    // 1. Strip ?reset=1 immediately so any user reload during the wipe
    //    doesn't loop back into this handler.
    window.history.replaceState({}, '', window.location.pathname)
    // 2. Do the wipe + force a clean reload of the now-bare URL.
    void (async () => {
      await wipeNoteserState()
      window.location.replace(window.location.pathname)
    })()
  }, [])

  // Kill-switch: bump PERSISTED_RESET_VERSION in code to force every
  // browser to wipe once on next visit. Two paths:
  //   1. No unsynced changes → silent PARTIAL wipe (drops notes/folders/
  //      workspace; preserves GitHub creds + settings + UI) + reload.
  //   2. Unsynced changes → in-app modal lets the user pick partial
  //      cleanup, full reset, or cancel. NOT window.confirm — that gets
  //      hidden behind tabs (user lost ~30 seconds clicking nothing).
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetHasUnsynced, setResetHasUnsynced] = useState(false)
  // Selector subscription — re-renders when the repo changes (connect /
  // disconnect) so the modal copy stays in sync without a getState() call
  // during JSX.
  const githubRepo = useGitHubStore(s => s.syncRepo)
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
    if (decision.action === 'markOnly') {
      writeStoredResetVersion(PERSISTED_RESET_VERSION)
      return
    }
    if (decision.action === 'wipe') {
      // No unsynced work — partial wipe + reload silently.
      void (async () => {
        await wipeNoteserState({ preserve: PRESERVE_ON_KILLSWITCH })
        writeStoredResetVersion(PERSISTED_RESET_VERSION)
        window.location.reload()
      })()
      return
    }
    // 'confirm' path: show the in-app modal.
    setResetHasUnsynced(hasUnsyncedChanges(
      useNoteStore.getState().notes,
      useGitHubStore.getState().lastSyncedAt,
    ))
    setShowResetModal(true)
  }, [hydrated])

  const handlePartialWipe = async () => {
    await wipeNoteserState({ preserve: PRESERVE_ON_KILLSWITCH })
    writeStoredResetVersion(PERSISTED_RESET_VERSION)
    window.location.reload()
  }
  const handleFullWipe = async () => {
    await wipeNoteserState()
    writeStoredResetVersion(PERSISTED_RESET_VERSION)
    window.location.reload()
  }

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
      <BugReportModal />
      <AIResultModal />
      <VaultSettingsConflictModal />
      <ResetConfirmModal
        isOpen={showResetModal}
        hasUnsynced={resetHasUnsynced}
        hasRepo={!!githubRepo}
        onPartialWipe={handlePartialWipe}
        onFullWipe={handleFullWipe}
        onCancel={() => setShowResetModal(false)}
      />
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
