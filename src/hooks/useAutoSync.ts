'use client'

import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@/stores'
import { useGitHubSync, type SyncState } from './useGitHubSync'
import { useHydration } from './useHydration'

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
  const hydrated = useHydration()
  const { runSync, runPullOnly, isConnected, syncState } = useGitHubSync()
  const autoSyncOnStart = useSettingsStore(s => s.autoSyncOnStart)
  const pullOnlyOnStartup = useSettingsStore(s => s.pullOnlyOnStartup)
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
    startupRanRef.current = true
    // pullOnlyOnStartup: run pull only on boot. Local unsynced edits
    // stay local until the user clicks Commit & Sync (the pending-
    // count chip in EditorFooter still surfaces them). Useful on
    // devices that frequently have work-in-flight notes the user
    // doesn't want auto-pushed on every page load.
    if (pullOnlyOnStartup) {
      void runPullOnly()
    } else {
      void runSync()
    }
  }, [hydrated, isConnected, autoSyncOnStart, pullOnlyOnStartup, runSync, runPullOnly])

  // ── Periodic sync ──────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return
    if (!isConnected) return
    if (!intervalMinutes || intervalMinutes <= 0) return

    const id = setInterval(() => {
      // Skip if a sync is already in flight — the previous run is still
      // working through its pull/apply/push pipeline.
      if (syncStateRef.current.kind === 'running') return
      void runSync()
    }, intervalMinutes * 60 * 1000)

    return () => clearInterval(id)
  }, [hydrated, isConnected, intervalMinutes, runSync])
}
