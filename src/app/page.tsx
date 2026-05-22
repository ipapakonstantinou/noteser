'use client'

import { useEffect, useState } from 'react'
import { Sidebar, RightSidebar, Ribbon, MobileTopBar } from '@/components/sidebar'
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
  FileHistoryModal,
  PublishGistModal,
  VaultEncryptionModal,
  RevertToCommitModal,
  LocalFolderImportModal,
} from '@/components/modals'
import { useSettingsStore } from '@/stores/settingsStore'
import { useKeyboardShortcuts, useHydration, useAutoSync, useAutoEmbedNotes, useApplyTheme, useViewport } from '@/hooks'
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
  const { isMobile } = useViewport()

  // Use default value during SSR to avoid hydration mismatch
  const isSidebarCollapsed = hydrated ? sidebarCollapsed : false
  // SSR / pre-hydration: render the desktop layout. Mobile branches
  // only kick in after the viewport hook has measured the real width,
  // matching the existing useViewport SSR contract.
  const mobileLayout = hydrated && isMobile
  // On mobile, the sidebar is an off-canvas drawer. We reuse
  // sidebarCollapsed: true = drawer closed, false = drawer open.
  const drawerOpen = mobileLayout && !isSidebarCollapsed

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

  // Lock-on-startup: if the vault has encryption enabled but the
  // in-memory key isn't loaded (every page refresh re-locks by
  // design — the key lives only in vaultKey's closure), prompt the
  // user to unlock before the first auto-sync runs.
  //
  // We subscribe to the setting via the store hook rather than
  // `getState()` so the effect re-runs once persisted state finishes
  // rehydrating (Zustand persist with localStorage is supposed to be
  // synchronous, but qa-tester confirmed the effect was missing the
  // hydrated→true → enabled→true window when read with getState()).
  const vaultEncryptionEnabled = useSettingsStore(s => s.vaultEncryptionEnabled)
  useEffect(() => {
    if (!hydrated) return
    if (!vaultEncryptionEnabled) return
    // Dynamic import so the desktop bundle doesn't eagerly load the
    // crypto module for every user.
    void import('@/utils/vaultKey').then(({ isVaultUnlocked }) => {
      if (!isVaultUnlocked()) {
        useUIStore.getState().openModal({ type: 'vault-encryption', data: { mode: 'unlock' } })
      }
    })
  }, [hydrated, vaultEncryptionEnabled])

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

  // Close the mobile drawer when the user clicks the backdrop or
  // presses Escape. Plain wrapper around toggleSidebar that only fires
  // when the drawer is actually open, so it can't accidentally OPEN
  // the drawer on desktop.
  const closeMobileDrawer = () => {
    if (drawerOpen) useUIStore.getState().toggleSidebar()
  }
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        useUIStore.getState().toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Modals are identical between mobile and desktop branches. Extracted
  // into a helper so the two render trees below don't drift.
  const renderModals = () => (
    <>
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
      <FileHistoryModal />
      <PublishGistModal />
      <VaultEncryptionModal />
      <RevertToCommitModal />
      <LocalFolderImportModal />
      <ResetConfirmModal
        isOpen={showResetModal}
        hasUnsynced={resetHasUnsynced}
        hasRepo={!!githubRepo}
        onPartialWipe={handlePartialWipe}
        onFullWipe={handleFullWipe}
        onCancel={() => setShowResetModal(false)}
      />
    </>
  )

  // Two distinct layout trees — mobile is a flex-COLUMN with a slim top
  // action bar above the editor and an off-canvas drawer behind, while
  // desktop is a flex-ROW with the ribbon column + sidebar column +
  // editor. Phase B of mobile responsive: the desktop ribbon is hidden
  // entirely on mobile so the 375px viewport doesn't lose ~12% to a
  // vertical icon strip the user can't read at that size.
  if (mobileLayout) {
    return (
      <div className="flex flex-col h-dvh w-screen bg-obsidianBlack text-obsidianText overflow-hidden">
        <MobileTopBar />

        {drawerOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 transition-opacity duration-200"
            onClick={closeMobileDrawer}
            aria-hidden="true"
            data-testid="mobile-sidebar-backdrop"
          />
        )}

        {/* Drawer — fixed-position, slides in from the LEFT EDGE now
            that the ribbon is gone. Width capped at min(280px, 85vw)
            so even a small phone leaves a peek of the editor behind.
            Pointer-events guarded so the closed drawer doesn't eat
            clicks on the underlying editor (qa fix from prior batch). */}
        <div
          className={`fixed top-0 bottom-0 z-40 transition-transform duration-300 ease-out ${
            drawerOpen
              ? 'translate-x-0 pointer-events-auto'
              : '-translate-x-full pointer-events-none'
          }`}
          style={{
            left: 0,
            width: 'min(280px, 85vw)',
          }}
          data-testid="mobile-sidebar-drawer"
          aria-hidden={drawerOpen ? undefined : true}
        >
          <Sidebar />
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <Editor />
        </div>

        {/* Modals are portaled to body so the column layout doesn't
            affect their positioning. Same set as desktop. */}
        {renderModals()}
      </div>
    )
  }

  return (
    <div className="flex h-dvh w-screen bg-obsidianBlack text-obsidianText overflow-hidden">
      {/* Ribbon */}
      <div className="flex-none">
        <Ribbon />
      </div>

      <div
        className={`flex-none transition-all duration-300 ${
          isSidebarCollapsed ? 'w-[50px]' : 'w-64'
        }`}
      >
        <Sidebar />
      </div>

      {/* Editor — width is "fill remaining" rather than the hard
          100vw calc we used before, so the right sidebar can claim
          its own track without us doing the arithmetic. flex-1
          + min-w-0 stops the editor from blowing past its allotted
          width when long note content tries to grow it. */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <Editor />
      </div>

      <RightSidebar />

      {renderModals()}
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
