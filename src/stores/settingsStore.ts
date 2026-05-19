import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '@/utils/storageKeys'

export type FolderSortMode = 'alphabetical' | 'modified' | 'created' | 'manual'
export type TaskListDensity = 'compact' | 'comfortable'

// Auto-sync interval in minutes. 0 = off. We constrain to a small set so
// the settings dropdown stays simple; passing arbitrary numbers also
// works at runtime.
export type AutoSyncInterval = 0 | 5 | 15 | 30 | 60

export interface SettingsState {
  folderSortMode: FolderSortMode
  taskListDensity: TaskListDensity
  // Show folders flagged as hidden (currently: the synthetic `attachments/`
  // folder). When false, those folders are suppressed from the sidebar.
  showHiddenFolders: boolean
  // Repo-relative folder where new attachments are saved. Empty / blank
  // falls back to the historical default `attachments`. Old refs in note
  // content continue to resolve regardless of this setting.
  attachmentsFolder: string
  // Run a sync (pull-then-push) once on app boot if a repo is connected.
  autoSyncOnStart: boolean
  // Run sync on this interval. 0 = off.
  autoSyncIntervalMinutes: AutoSyncInterval

  setFolderSortMode: (mode: FolderSortMode) => void
  setTaskListDensity: (density: TaskListDensity) => void
  setShowHiddenFolders: (value: boolean) => void
  setAttachmentsFolder: (folder: string) => void
  setAutoSyncOnStart: (value: boolean) => void
  setAutoSyncIntervalMinutes: (minutes: AutoSyncInterval) => void
  reset: () => void
}

const DEFAULTS = {
  folderSortMode: 'alphabetical' as FolderSortMode,
  taskListDensity: 'comfortable' as TaskListDensity,
  showHiddenFolders: true,
  attachmentsFolder: 'attachments',
  autoSyncOnStart: true,
  autoSyncIntervalMinutes: 0 as AutoSyncInterval,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setFolderSortMode: (folderSortMode) => set({ folderSortMode }),
      setTaskListDensity: (taskListDensity) => set({ taskListDensity }),
      setShowHiddenFolders: (showHiddenFolders) => set({ showHiddenFolders }),
      setAttachmentsFolder: (attachmentsFolder) => set({ attachmentsFolder }),
      setAutoSyncOnStart: (autoSyncOnStart) => set({ autoSyncOnStart }),
      setAutoSyncIntervalMinutes: (autoSyncIntervalMinutes) => set({ autoSyncIntervalMinutes }),
      reset: () => set(DEFAULTS),
    }),
    { name: STORAGE_KEYS.settings }
  )
)
