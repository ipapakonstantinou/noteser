'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Sidebar, RightSidebar, Ribbon, MobileTopBar, DrawerHandle, SidebarResizeHandle } from '@/components/sidebar'
import { Editor } from '@/components/editor'
import { Toaster } from '@/components/ui'

// Modals are code-split out of the route's first-load bundle. Each one
// renders `null` until its store flag opens it, so deferring the code load
// is behaviour-preserving: the chunk fetches on the first open and the
// modal then behaves exactly as before. ssr:false because the whole app is
// client-only anyway, and the modals read client-only state (localStorage /
// IDB-hydrated stores). The 1,490-line SettingsModal and CommandPalette
// (which statically imports fuse.js) are the biggest wins here.
const SearchModal = dynamic(() => import('@/components/modals/SearchModal').then(m => ({ default: m.SearchModal })), { ssr: false })
const DeleteConfirmModal = dynamic(() => import('@/components/modals/DeleteConfirmModal').then(m => ({ default: m.DeleteConfirmModal })), { ssr: false })
const ShortcutsModal = dynamic(() => import('@/components/modals/ShortcutsModal').then(m => ({ default: m.ShortcutsModal })), { ssr: false })
const TemplatesModal = dynamic(() => import('@/components/modals/TemplatesModal').then(m => ({ default: m.TemplatesModal })), { ssr: false })
const SettingsModal = dynamic(() => import('@/components/modals/SettingsModal').then(m => ({ default: m.SettingsModal })), { ssr: false })
const ExportModal = dynamic(() => import('@/components/modals/ExportModal').then(m => ({ default: m.ExportModal })), { ssr: false })
const GitHubAuthModal = dynamic(() => import('@/components/modals/GitHubAuthModal').then(m => ({ default: m.GitHubAuthModal })), { ssr: false })
const GitHubRepoModal = dynamic(() => import('@/components/modals/GitHubRepoModal').then(m => ({ default: m.GitHubRepoModal })), { ssr: false })
const TaskEditModal = dynamic(() => import('@/components/modals/TaskEditModal').then(m => ({ default: m.TaskEditModal })), { ssr: false })
const CommandPalette = dynamic(() => import('@/components/modals/CommandPalette').then(m => ({ default: m.CommandPalette })), { ssr: false })
const BugReportModal = dynamic(() => import('@/components/modals/BugReportModal').then(m => ({ default: m.BugReportModal })), { ssr: false })
const AIResultModal = dynamic(() => import('@/components/modals/AIResultModal').then(m => ({ default: m.AIResultModal })), { ssr: false })
const VaultSettingsConflictModal = dynamic(() => import('@/components/modals/VaultSettingsConflictModal').then(m => ({ default: m.VaultSettingsConflictModal })), { ssr: false })
const FileHistoryModal = dynamic(() => import('@/components/modals/FileHistoryModal').then(m => ({ default: m.FileHistoryModal })), { ssr: false })
const PublishGistModal = dynamic(() => import('@/components/modals/PublishGistModal').then(m => ({ default: m.PublishGistModal })), { ssr: false })
const VaultEncryptionModal = dynamic(() => import('@/components/modals/VaultEncryptionModal').then(m => ({ default: m.VaultEncryptionModal })), { ssr: false })
const RevertToCommitModal = dynamic(() => import('@/components/modals/RevertToCommitModal').then(m => ({ default: m.RevertToCommitModal })), { ssr: false })
const LocalFolderImportModal = dynamic(() => import('@/components/modals/LocalFolderImportModal').then(m => ({ default: m.LocalFolderImportModal })), { ssr: false })
const DiscardLocalChangesModal = dynamic(() => import('@/components/modals/DiscardLocalChangesModal').then(m => ({ default: m.DiscardLocalChangesModal })), { ssr: false })
import { useSettingsStore } from '@/stores/settingsStore'
import { useKeyboardShortcuts, useHydration, useAutoSync, useAutoEmbedNotes, useApplyTheme, useApplyFonts, useViewport } from '@/hooks'
import { useUIStore, useWorkspaceStore, useGitHubStore, DEFAULT_SIDEBAR_WIDTH } from '@/stores'
import { switchVault } from '@/utils/switchVault'
import { notesKey } from '@/utils/repoStorage'
import { useNoteStore } from '@/stores/noteStore'
import { STORAGE_KEYS } from '@/utils/storageKeys'
import { installTestHooks } from '@/utils/testHooks'
import { shouldTrackSwipe, detectSwipeAction } from '@/utils/edgeSwipe'
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
const ResetConfirmModal = dynamic(
  () => import('@/components/modals/ResetConfirmModal').then(m => ({ default: m.ResetConfirmModal })),
  { ssr: false },
)

export default function Home() {
  const hydrated = useHydration()
  const { sidebarCollapsed, sidebarWidth } = useUIStore()
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

  // Startup sequencing. The note/folder stores rehydrate from IndexedDB
  // ASYNC, and for a GitHub-connected vault the real notes live under a
  // repo-scoped key we only switch to AFTER mount. We MUST NOT prune
  // "orphaned" tabs or run the restore-fallback until the correct notes are
  // genuinely loaded: otherwise prune sees zero notes, treats every persisted
  // tab as orphaned, wipes the workspace, and writes the empty result back —
  // so on a synced vault the tabs never come back on reload. `vaultReady`
  // gates those steps until the vault's notes are actually present.
  const [vaultReady, setVaultReady] = useState(false)
  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    void (async () => {
      // 1. Wait for the note store's own (async, IDB-backed) rehydration.
      if (!useNoteStore.persist.hasHydrated()) {
        await new Promise<void>(resolve => {
          let settled = false
          const finish = () => { if (!settled) { settled = true; resolve() } }
          const unsub = useNoteStore.persist.onFinishHydration(() => { unsub(); finish() })
          // Safety net: never hang if the finish event was already missed.
          setTimeout(finish, 3000)
        })
      }
      // 2. If a repo is connected but we're still on the unscoped default key,
      //    switch to the scoped key — this loads the real vault from IDB, so
      //    the notes are present once it resolves.
      const repo = useGitHubStore.getState().syncRepo
      if (repo) {
        const currentName = useNoteStore.persist.getOptions().name as string
        if (currentName !== notesKey(repo)) {
          await switchVault(repo, { carryOver: true })
            .catch(err => console.error('Vault scope migration failed', err))
        }
      }
      if (!cancelled) setVaultReady(true)
    })()
    return () => { cancelled = true }
  }, [hydrated])

  // Once the vault's notes are genuinely loaded: drop tabs whose note is
  // really gone, then — only if nothing is open — restore a useful note.
  // Preference: the previously-active note, else the most-recently-updated.
  // When the user has turned "reopen tabs on startup" off, skip restoring and
  // start fresh with an empty workspace instead.
  useEffect(() => {
    if (!vaultReady) return
    if (!useSettingsStore.getState().reopenTabsOnStartup) {
      useWorkspaceStore.getState().resetToEmptyWorkspace()
      return
    }
    pruneStaleTabs()

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
      target = activeNotes.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]
    }
    if (target) ws.openNote(target.id, { preview: false })
  }, [vaultReady, pruneStaleTabs])

  // Set up keyboard shortcuts
  useKeyboardShortcuts()

  // Mouse back / forward buttons (the thumb buttons, DOM button 3 = back,
  // button 4 = forward) drive the active pane's note history — same as the
  // header arrows and Alt+←/→.
  //
  // The browser's own page back/forward fires on the button's MOUSEDOWN,
  // not mouseup, so we must preventDefault on `mousedown` to stop the page
  // from navigating out from under the SPA. The actual note navigation then
  // runs once on `mouseup` (one step per physical press). Doing both on
  // mouseup let the browser navigate first — and on a freshly-loaded SPA
  // that could even unload the app.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      // Suppress the browser's native history navigation for the thumb
      // buttons; we handle them ourselves on mouseup.
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        useWorkspaceStore.getState().goBack()
      } else if (e.button === 4) {
        e.preventDefault()
        useWorkspaceStore.getState().goForward()
      }
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Auto-sync on startup + on the configured interval (Settings → GitHub).
  useAutoSync()

  // Auto re-embed notes on save when AI embeddings are enabled (a1f7
  // phase B). No-ops when the feature is off; per-note 5s debounce.
  useAutoEmbedNotes()

  // Apply the user's theme overrides (th3m) — writes any non-default
  // colors to :root CSS variables so Tailwind utilities pick them up
  // live. No-op when themeOverrides is empty.
  useApplyTheme()

  // Apply the user's font choices (fnt1) — writes chosen font-family
  // values to --font-text / --font-mono / --font-interface on :root.
  // No-op when all three are empty (system defaults).
  useApplyFonts()

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

  // Bootstrap any plugins the user has installed (Settings → Plugins).
  // Each enabled plugin spawns its own Web Worker and boots; hash
  // mismatches are surfaced as a toast and the load skipped.
  // Dynamic import keeps the plugin code off the first-paint bundle.
  useEffect(() => {
    void import('@/plugins/pluginHostSingleton').then(({ bootstrapInstalledPlugins }) => {
      void bootstrapInstalledPlugins()
    })
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

  // Mobile edge-swipe: right-swipe from the left edge opens the
  // drawer; left-swipe anywhere closes it. Matches the iOS/Android
  // "swipe from edge to reveal sidebar" idiom. Desktop is unaffected
  // because mobileLayout gates it. Decision logic lives in
  // `src/utils/edgeSwipe.ts` so it's unit-testable.
  useEffect(() => {
    if (!mobileLayout) return
    let startX = 0
    let startY = 0
    let tracking = false
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (!shouldTrackSwipe(drawerOpen, t.clientX)) return
      startX = t.clientX
      startY = t.clientY
      tracking = true
    }
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      if (!t) return
      const action = detectSwipeAction(drawerOpen, t.clientX - startX, t.clientY - startY)
      if (action) useUIStore.getState().toggleSidebar()
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [mobileLayout, drawerOpen])

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
      <DiscardLocalChangesModal />
      <ResetConfirmModal
        isOpen={showResetModal}
        hasUnsynced={resetHasUnsynced}
        hasRepo={!!githubRepo}
        onPartialWipe={handlePartialWipe}
        onFullWipe={handleFullWipe}
        onCancel={() => setShowResetModal(false)}
      />
      {/* Toast host — rendered once for both layouts. Fixed bottom-center,
          safe-area aware, above the modals/nav. */}
      <Toaster />
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

        {/* Visible left-edge handle to open the drawer. The edge-swipe
            (above) is unreliable on iOS WebKit because the browser claims
            the outermost-edge swipe for back-navigation, so this handle is
            the dependable, discoverable path. Shown only while the drawer
            is closed; the backdrop handles closing once it's open. */}
        {!drawerOpen && <DrawerHandle />}

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

      {/* Sidebar column. Collapsed → fixed 50px rail. Expanded → the
          user-set, drag-resizable width from useUIStore (defaults to
          256 = the old w-64). We DROP the width transition while
          expanded so the drag tracks the pointer 1:1 instead of
          lagging behind a 300ms ease; the collapse toggle keeps its
          animation. Pre-hydration we render the default width to avoid
          an SSR/client mismatch (sidebarWidth is persisted). */}
      <div
        className={`flex-none ${
          isSidebarCollapsed ? 'w-[50px] transition-all duration-300' : ''
        }`}
        style={isSidebarCollapsed ? undefined : { width: hydrated ? sidebarWidth : DEFAULT_SIDEBAR_WIDTH }}
      >
        <Sidebar />
      </div>

      {/* Drag-to-resize handle — sits between the sidebar and the
          editor. Only meaningful when the sidebar is expanded. */}
      {!isSidebarCollapsed && <SidebarResizeHandle />}

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
