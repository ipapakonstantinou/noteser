'use client'

import { create } from 'zustand'

// State for the "local folder sync" feature (Chromium File System Access).
//
// The directory HANDLE itself is persisted in IndexedDB via
// `saveLocalFolderHandle` / `loadLocalFolderHandle` in
// `src/utils/localFolderSync.ts` — Zustand persist can't structured-
// clone a FileSystemDirectoryHandle into localStorage. This store
// holds only the in-memory state: are we connected, what's the
// folder name, when did the last sync run, is sync in flight.

export type LocalFolderStatus =
  | 'idle'           // never connected this session
  | 'reconnecting'   // saw a saved handle, prompting for permission
  | 'connected'      // permission granted, ready to sync
  | 'denied'         // user denied the permission prompt
  | 'unsupported'    // browser lacks the API (Firefox / Safari)

interface LocalFolderState {
  status: LocalFolderStatus
  // Loaded after permission is granted. Held in memory only; on
  // refresh, retrieved from IDB and re-prompts for permission.
  handle: FileSystemDirectoryHandle | null
  // Display name from the picked directory. Used for the Settings
  // status row + the sidebar status pill.
  folderName: string | null
  // Timestamp of the most recent successful mirror in either
  // direction. null until the first push/import completes.
  lastSyncedAt: number | null
  // True while a push or import is in flight. Used to gate the UI
  // buttons + show a spinner.
  busy: boolean
  // Last error from a sync operation. Cleared on the next successful
  // sync attempt.
  lastError: string | null
}

interface LocalFolderActions {
  setStatus: (s: LocalFolderStatus) => void
  setHandle: (h: FileSystemDirectoryHandle | null, folderName: string | null) => void
  setBusy: (b: boolean) => void
  setLastError: (e: string | null) => void
  recordSync: () => void
  reset: () => void
}

const initial: LocalFolderState = {
  status: 'idle',
  handle: null,
  folderName: null,
  lastSyncedAt: null,
  busy: false,
  lastError: null,
}

export const useLocalFolderStore = create<LocalFolderState & LocalFolderActions>()((set) => ({
  ...initial,
  setStatus: (status) => set({ status }),
  setHandle: (handle, folderName) => set({ handle, folderName }),
  setBusy: (busy) => set({ busy }),
  setLastError: (lastError) => set({ lastError }),
  recordSync: () => set({ lastSyncedAt: Date.now(), lastError: null }),
  reset: () => set(initial),
}))
