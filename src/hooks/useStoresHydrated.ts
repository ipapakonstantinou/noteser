import { useState, useEffect } from 'react'
import { useNoteStore, useFolderStore } from '@/stores'

/**
 * Tracks whether the persisted note + folder stores have finished their
 * ASYNCHRONOUS rehydration from IndexedDB (idbStorage).
 *
 * WHY THIS EXISTS — the mass-duplicate bug:
 *   `useHydration()` returns true the moment the first `useEffect` fires
 *   (i.e. the component has mounted). That says NOTHING about whether the
 *   note/folder stores have actually been rehydrated from IndexedDB. With
 *   an async storage adapter the stores can still be EMPTY at that point.
 *
 *   The startup auto-pull was gated only on `useHydration()`. When it fired
 *   before rehydration completed, `useGitHubSync.runPull` read an empty
 *   `useNoteStore.getState().notes` / `useFolderStore.getState().folders`,
 *   wrongly concluded `isFirstClone === true`, and re-imported the WHOLE
 *   vault as `remoteCreated` — duplicating every note on every page load.
 *   (A service worker that serves the shell instantly makes the race fire
 *   reliably.)
 *
 * This hook returns true only once BOTH stores report `hasHydrated()`. It
 * subscribes to `onFinishHydration` so the component re-renders the moment
 * async rehydration completes. Zustand's persist middleware tracks hydration
 * independently of the storage adapter, so this works with idbStorage exactly
 * as it would with localStorage.
 */
export function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const check = () =>
      useNoteStore.persist.hasHydrated() && useFolderStore.persist.hasHydrated()

    // Already hydrated (e.g. a remount after the stores finished) — flip
    // immediately so we don't wait on an onFinishHydration that already fired.
    if (check()) {
      setHydrated(true)
      return
    }

    // Re-evaluate when either store finishes its async rehydration. Both
    // unsubscribers are called on cleanup.
    const unsubNotes = useNoteStore.persist.onFinishHydration(() => {
      if (check()) setHydrated(true)
    })
    const unsubFolders = useFolderStore.persist.onFinishHydration(() => {
      if (check()) setHydrated(true)
    })

    return () => {
      unsubNotes()
      unsubFolders()
    }
  }, [])

  return hydrated
}
