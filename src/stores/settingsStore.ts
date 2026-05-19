import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FolderSortMode = 'alphabetical' | 'modified' | 'created' | 'manual'
export type TaskListDensity = 'compact' | 'comfortable'

interface SettingsState {
  folderSortMode: FolderSortMode
  taskListDensity: TaskListDensity

  setFolderSortMode: (mode: FolderSortMode) => void
  setTaskListDensity: (density: TaskListDensity) => void
  reset: () => void
}

const DEFAULTS = {
  folderSortMode: 'alphabetical' as FolderSortMode,
  taskListDensity: 'compact' as TaskListDensity,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setFolderSortMode: (folderSortMode) => set({ folderSortMode }),
      setTaskListDensity: (taskListDensity) => set({ taskListDensity }),
      reset: () => set(DEFAULTS),
    }),
    { name: 'noteser-settings' }
  )
)
