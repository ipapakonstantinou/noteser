import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FolderSortMode = 'alphabetical' | 'modified' | 'created' | 'manual'
export type TaskListDensity = 'compact' | 'comfortable'

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

  setFolderSortMode: (mode: FolderSortMode) => void
  setTaskListDensity: (density: TaskListDensity) => void
  setShowHiddenFolders: (value: boolean) => void
  setAttachmentsFolder: (folder: string) => void
  reset: () => void
}

const DEFAULTS = {
  folderSortMode: 'alphabetical' as FolderSortMode,
  taskListDensity: 'comfortable' as TaskListDensity,
  showHiddenFolders: true,
  attachmentsFolder: 'attachments',
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setFolderSortMode: (folderSortMode) => set({ folderSortMode }),
      setTaskListDensity: (taskListDensity) => set({ taskListDensity }),
      setShowHiddenFolders: (showHiddenFolders) => set({ showHiddenFolders }),
      setAttachmentsFolder: (attachmentsFolder) => set({ attachmentsFolder }),
      reset: () => set(DEFAULTS),
    }),
    { name: 'noteser-settings' }
  )
)
