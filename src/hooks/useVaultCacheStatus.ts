'use client'

// useVaultCacheStatus — offline-first Step 1 (#68).
//
// Surfaces the cached snapshot the sync layer wrote on the last successful
// pull (see `src/utils/vaultSnapshotCache.ts`) AND the live `navigator.onLine`
// signal so any UI affordance can answer two questions:
//
//   1. Are we offline right now?
//   2. What was the last commit we synced against (so a "viewing cached
//      state" badge can show a real SHA + time)?
//
// Read-only hook: the UI consumes it. Writes happen in `syncPull.ts` after
// a successful classify.

import { useEffect, useState } from 'react'
import { useGitHubStore } from '@/stores/githubStore'
import { readVaultSnapshot, type VaultSnapshot } from '@/utils/vaultSnapshotCache'

export interface VaultCacheStatus {
  /** True when the browser reports offline. Defaults to false on SSR. */
  isOffline: boolean
  /** Last successful pull's anchor — null when never synced for this repo. */
  snapshot: VaultSnapshot | null
}

export function useVaultCacheStatus(): VaultCacheStatus {
  // We deliberately do NOT subscribe to a fine-grained selector here —
  // the consumer re-renders when `online`/`offline` events fire or when the
  // repo identity changes, and that's enough granularity. The whole hook
  // returns a stable shape with two scalars + one snapshot object.
  const syncRepo = useGitHubStore(s => s.syncRepo)

  const [isOffline, setIsOffline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return false
    // navigator.onLine === false is the only reliable "definitely offline"
    // signal in the browser. true can mean "has a network interface", not
    // "the internet is reachable" — but for our sync-vs-skip-toast decision
    // false is what we care about.
    return navigator.onLine === false
  })

  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null)

  // Track online/offline transitions. Cleanup on unmount + on repo change.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOnline = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Load the snapshot for the active repo. Re-read when the repo changes
  // (vault switch). A null repo means "no GitHub connected" — snapshot
  // stays null.
  useEffect(() => {
    let cancelled = false
    if (!syncRepo) {
      setSnapshot(null)
      return
    }
    void (async () => {
      const snap = await readVaultSnapshot(syncRepo)
      if (!cancelled) setSnapshot(snap)
    })()
    return () => { cancelled = true }
    // Re-key on owner/name only. Branch changes don't reshape the snapshot
    // (branch is captured in the SHA already).
  }, [syncRepo])

  return { isOffline, snapshot }
}
