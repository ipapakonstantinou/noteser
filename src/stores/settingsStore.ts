import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '@/utils/storageKeys'

export type FolderSortMode = 'alphabetical' | 'modified' | 'created' | 'manual'
export type TaskListDensity = 'compact' | 'comfortable'

// Bring-your-own-key AI provider. `'off'` disables every AI feature; the
// aiClient throws if a feature is invoked while off so callers can show a
// friendly "set up AI in settings" hint instead of silently no-op-ing.
export type AIProvider = 'off' | 'anthropic' | 'openai'

// Default model per provider. Stored as a free-form string so users can
// override (e.g. point at a newer snapshot, an Azure deployment name, or a
// local proxy). The Settings UI shows the matching default as a placeholder.
export const DEFAULT_AI_MODEL: Record<Exclude<AIProvider, 'off'>, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
}

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
  // Minutes between auto-syncs. 0 = off. Any positive integer is valid.
  autoSyncIntervalMinutes: number
  // Repo-relative folder for daily notes. Empty falls back to the default.
  dailyNotesFolder: string
  // Date format used as both the title of a daily note and the calendar
  // lookup key. Supports YYYY YY MM M DD D dddd ddd MMMM MMM.
  dailyNoteDateFormat: string
  // Repo-relative folder for template notes (one .md per template).
  templatesFolder: string
  // ID of the note (in `templatesFolder`) whose content seeds new daily
  // notes. null = no template; new daily notes start empty.
  dailyNoteTemplateId: string | null

  // ── AI (BYO key) ──────────────────────────────────────────────────────
  // Which provider the aiClient targets. `'off'` (default) disables every
  // AI feature.
  aiProvider: AIProvider
  // SECURITY NOTE: localStorage is readable by any script on the page; any
  // XSS would expose the key. Same trust model the GitHub OAuth token uses
  // (see `githubStore.ts`). Acceptable for a personal note tool, NOT for a
  // multi-tenant SaaS. The key is sent only to the configured provider's
  // public API endpoint, never to a noteser-controlled server.
  aiApiKey: string
  // Free-form model id so users can switch snapshots without a redeploy.
  // Defaults to `DEFAULT_AI_MODEL[aiProvider]` semantically; we seed the
  // anthropic default at install time so the field is never blank for the
  // common case.
  aiModel: string

  setFolderSortMode: (mode: FolderSortMode) => void
  setTaskListDensity: (density: TaskListDensity) => void
  setShowHiddenFolders: (value: boolean) => void
  setAttachmentsFolder: (folder: string) => void
  setAutoSyncOnStart: (value: boolean) => void
  setAutoSyncIntervalMinutes: (minutes: number) => void
  setDailyNotesFolder: (folder: string) => void
  setDailyNoteDateFormat: (format: string) => void
  setTemplatesFolder: (folder: string) => void
  setDailyNoteTemplateId: (id: string | null) => void
  setAiProvider: (provider: AIProvider) => void
  setAiApiKey: (key: string) => void
  setAiModel: (model: string) => void
  reset: () => void
}

const DEFAULTS = {
  folderSortMode: 'alphabetical' as FolderSortMode,
  taskListDensity: 'comfortable' as TaskListDensity,
  showHiddenFolders: true,
  attachmentsFolder: 'attachments',
  autoSyncOnStart: true,
  autoSyncIntervalMinutes: 0,
  dailyNotesFolder: 'Daily Notes',
  dailyNoteDateFormat: 'YYYY-MM-DD',
  templatesFolder: 'Templates',
  dailyNoteTemplateId: null as string | null,
  aiProvider: 'off' as AIProvider,
  aiApiKey: '',
  aiModel: DEFAULT_AI_MODEL.anthropic,
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
      setDailyNotesFolder: (dailyNotesFolder) => set({ dailyNotesFolder }),
      setDailyNoteDateFormat: (dailyNoteDateFormat) => set({ dailyNoteDateFormat }),
      setTemplatesFolder: (templatesFolder) => set({ templatesFolder }),
      setDailyNoteTemplateId: (dailyNoteTemplateId) => set({ dailyNoteTemplateId }),
      setAiProvider: (aiProvider) => set({ aiProvider }),
      setAiApiKey: (aiApiKey) => set({ aiApiKey }),
      setAiModel: (aiModel) => set({ aiModel }),
      reset: () => set(DEFAULTS),
    }),
    { name: STORAGE_KEYS.settings }
  )
)
