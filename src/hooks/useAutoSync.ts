'use client'

import { useEffect, useRef } from 'react'
import { useSettingsStore, useNoteStore } from '@/stores'
import { useGitHubSync, type SyncState } from './useGitHubSync'
import { useStoresHydrated } from './useStoresHydrated'
import { fillShellsInBackground } from '@/utils/backgroundFill'

// Drives the two auto-sync behaviours configurable from Settings:
//
//   1. autoSyncOnStart — run a single sync soon after the app hydrates
//      and a GitHub repo is configured. Once-per-mount; not re-armed
//      when the setting toggles back on later (a manual sync covers
//      that case fine).
//
//   2. autoSyncIntervalMinutes — repeat the sync on the chosen cadence.
//      0 disables. The interval is rebuilt only when the cadence or the
//      connected-state changes; syncState is tracked through a ref so
//      the per-render syncState transitions don't tear the timer down.
//
// Reuses useGitHubSync.runSync — the same pull → apply → push pipeline
// the sidebar's Commit & Sync button uses. Conflicts open the merge
// editor exactly the same way.

export function useAutoSync(): void {
  // Gate on REAL store hydration, not just component mount. The note/folder
  // stores persist to IndexedDB (idbStorage) and rehydrate asynchronously, so
  // a mount-only signal (the old useHydration) could fire the startup pull
  // while the stores were still EMPTY — making runPull mistake an unhydrated
  // store for a brand-new vault and re-import everything (mass-duplicate bug).
  // useStoresHydrated stays false until BOTH stores report hasHydrated().
  const hydrated = useStoresHydrated()
  // Auto-sync is PULL-ONLY: runSync (which pushes) is intentionally not used
  // here — push only happens on an explicit user action.
  const { runPullOnly, isConnected, syncState } = useGitHubSync()
  const autoSyncOnStart = useSettingsStore(s => s.autoSyncOnStart)
  const intervalMinutes = useSettingsStore(s => s.autoSyncIntervalMinutes)

  // Latest syncState in a ref so the interval callback can read it
  // without forcing the interval to rebuild on every state transition.
  const syncStateRef = useRef<SyncState>(syncState)
  useEffect(() => { syncStateRef.current = syncState }, [syncState])

  // ── One-shot on startup ────────────────────────────────────────────
  const startupRanRef = useRef(false)
  useEffect(() => {
    if (!hydrated) return
    if (startupRanRef.current) return
    if (!isConnected) return
    if (!autoSyncOnStart) return
    // Offline-first Step 1 (#68): if the browser already knows it's
    // offline, skip the startup pull entirely. Notes / folders / tabs
    // have already hydrated from IDB via Zustand persist, so the app is
    // fully readable from the cached vault snapshot. Trying to pull
    // anyway would surface a "Sync failed" toast that's both noisy AND
    // misleading — the user did not fail anything. The `online`
    // listener below picks the pull back up the moment connectivity
    // returns. The pull-on-focus path in PwaProvider also serves as a
    // backstop.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      startupRanRef.current = true
      return
    }
    startupRanRef.current = true
    // Auto-sync NEVER pushes. Pushing happens only on an explicit user action
    // (Commit & Sync, revert, discard, connecting a repo). On boot we PULL
    // only, so the app never rewrites the user's repo without them clicking.
    // Firm product rule: "if I don't click Commit & Sync, it must not push."
    void runPullOnly()
  }, [hydrated, isConnected, autoSyncOnStart, runPullOnly])

  // ── Catch up when connectivity returns ─────────────────────────────
  // We may have started up offline (the branch above) OR we may have
  // dropped the network mid-session — either way an `online` event is the
  // cue to pull. Throttle via `lastOnlineAtRef` so a flapping connection
  // doesn't fire a sync per event. autoSyncOnStart gates this just like
  // the startup branch (a user who disabled auto-sync on start also
  // doesn't want a surprise pull when they come back online).
  const lastOnlineAtRef = useRef(0)
  useEffect(() => {
    if (!hydrated) return
    if (!isConnected) return
    if (!autoSyncOnStart) return
    const onOnline = () => {
      const now = Date.now()
      if (now - lastOnlineAtRef.current < 5_000) return
      lastOnlineAtRef.current = now
      if (syncStateRef.current.kind === 'running') return
      void runPullOnly()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [hydrated, isConnected, autoSyncOnStart, runPullOnly])

  // ── progressive-clone: resume the body fill after a reload ──────────
  // A first clone that was interrupted (reload, crash, navigate-away) leaves
  // SHELL notes persisted in IDB with their bodies unfetched. On the next boot
  // we kick the background fill so the vault finishes populating — INDEPENDENT
  // of autoSyncOnStart, because a user who disabled auto-sync still wants their
  // half-cloned vault to finish. fillShellsInBackground is a no-op when there
  // are no shells (the common case), is self-guarded against running twice, and
  // never pushes — so this is safe to fire unconditionally once connected.
  const resumeRanRef = useRef(false)
  useEffect(() => {
    if (!hydrated) return
    if (resumeRanRef.current) return
    if (!isConnected) return
    resumeRanRef.current = true
    const hasShells = useNoteStore.getState().notes.some(
      n => !n.isDeleted && n.contentLoaded === false,
    )
    if (!hasShells) return
    void fillShellsInBackground()
  }, [hydrated, isConnected])

  // ── Periodic sync ──────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return
    if (!isConnected) return
    if (!intervalMinutes || intervalMinutes <= 0) return

    const id = setInterval(() => {
      // Skip if a sync is already in flight.
      if (syncStateRef.current.kind === 'running') return
      // Pull only — the periodic auto-sync never pushes (see startup above).
      void runPullOnly()
    }, intervalMinutes * 60 * 1000)

    return () => clearInterval(id)
  }, [hydrated, isConnected, intervalMinutes, runPullOnly])
}
