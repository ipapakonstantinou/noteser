import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FolderSortMode = 'alphabetical' | 'modified' | 'created' | 'manual'
export type TaskListDensity = 'compact' | 'comfortable'

interface SettingsState {
  folderSortMode: FolderSortMode
  taskListDensity: TaskListDensity
  // Show folders flagged as hidden (currently: the synthetic `attachments/`
  // folder). When false, those folders are suppressed from the sidebar.
  showHiddenFolders: boolean

  setFolderSortMode: (mode: FolderSortMode) => void
  setTaskListDensity: (density: TaskListDensity) => void
  setShowHiddenFolders: (value: boolean) => void
  reset: () => void
}

const DEFAULTS = {
  folderSortMode: 'alphabetical' as FolderSortMode,
  taskListDensity: 'compact' as TaskListDensity,
  showHiddenFolders: true,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setFolderSortMode: (folderSortMode) => set({ folderSortMode }),
      setTaskListDensity: (taskListDensity) => set({ taskListDensity }),
      setShowHiddenFolders: (showHiddenFolders) => set({ showHiddenFolders }),
      reset: () => set(DEFAULTS),
    }),
    { name: 'noteser-settings' }
  )
)
