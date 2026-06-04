// Central export for all stores
export { useNoteStore } from './noteStore'
export { useFolderStore } from './folderStore'
export { useTagStore } from './tagStore'
export {
  useUIStore,
  DEFAULT_SECTION_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from './uiStore'
export type { SidebarSectionId, SidebarSectionState, SidebarTabId } from './uiStore'
export { useGitHubStore } from './githubStore'
export { useWorkspaceStore } from './workspaceStore'
export { useSettingsStore, newSidebarGroupId, legacyToSidebarGroups, MIN_GROUP_HEIGHT } from './settingsStore'
export type { FolderSortMode, TaskListDensity, AIProvider, SidebarGroupState } from './settingsStore'
export { useLocalFolderStore } from './localFolderStore'
export type { LocalFolderStatus } from './localFolderStore'
