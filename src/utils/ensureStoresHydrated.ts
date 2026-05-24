// HARD SAFETY GUARD against the mass-duplicate bug (defense in depth).
//
// The note + folder stores persist to IndexedDB via idbStorage — an
// ASYNCHRONOUS storage adapter. Until rehydration completes the in-memory
// `useNoteStore.getState().notes` / `useFolderStore.getState().folders` are
// EMPTY, even on a device that has a full vault on disk.
//
// `runPull` (useGitHubSync) classifies the pull off those in-memory arrays:
//   - an empty store is mistaken for a brand-new vault → `isFirstClone` is
//     wrongly true → the WHOLE remote vault is re-imported as `remoteCreated`
//     via the zipball path (mass duplicate notes), and
//   - even the incremental path would classify every remote file as
//     `remoteCreated` against the empty local set.
//
// So NO sync may read the store for classification until hydration is done.
// This guard awaits `rehydrate()` for any store that hasn't hydrated yet.
// Callers gate the trigger on `useStoresHydrated()`; this is the belt-and-
// braces layer so that even a caller that forgot to gate can never trigger
// the re-import on an unhydrated store.
//
// A genuinely empty vault (nothing persisted, hydration completed) still
// reads as empty afterwards — so the legitimate first-clone path is
// untouched. The fix only stops MISTAKING an unhydrated store for an empty one.
import { useNoteStore, useFolderStore } from '@/stores'

// Returns a promise that resolves once both stores are hydrated, OR `null`
// when both are ALREADY hydrated. Returning null lets the caller skip the
// `await` entirely in the common (already-hydrated) case, so it doesn't insert
// a needless microtask boundary on the hot path — only the genuine race waits.
export function pendingStoreHydration(): Promise<unknown> | null {
  const pending: Promise<unknown>[] = []
  // rehydrate() is typed `void | Promise<void>` (sync storage returns void);
  // Promise.resolve() normalises both so we can await uniformly.
  if (!useNoteStore.persist.hasHydrated()) {
    pending.push(Promise.resolve(useNoteStore.persist.rehydrate()))
  }
  if (!useFolderStore.persist.hasHydrated()) {
    pending.push(Promise.resolve(useFolderStore.persist.rehydrate()))
  }
  return pending.length ? Promise.all(pending) : null
}

export async function ensureStoresHydrated(): Promise<void> {
  const pending = pendingStoreHydration()
  if (pending) await pending
}
