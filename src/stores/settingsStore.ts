import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '@/utils/storageKeys'

export type FolderSortMode = 'alphabetical' | 'modified' | 'created' | 'manual'
export type TaskListDensity = 'compact' | 'comfortable'

// Trash behaviour on note + folder deletion.
//   'trash'      → existing soft-delete (default). Items live in the Trash
//                  view, can be restored, are removed from the active
//                  sidebar tree.
//   'hardDelete' → no Trash. Deletions are immediate and irreversible
//                  locally (sync still gets to push a tree-delete on the
//                  next round-trip).
export type TrashMode = 'trash' | 'hardDelete'

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
  // Periodic notes (weekly / monthly). Same shape as daily — folder + format.
  // Default formats use the new ISO-week / quarter tokens added to
  // dateFormat.ts. Empty falls back to the defaults.
  weeklyNotesFolder: string
  weeklyNoteDateFormat: string
  monthlyNotesFolder: string
  monthlyNoteDateFormat: string
  // Repo-relative folder for template notes (one .md per template).
  templatesFolder: string
  // ID of the note (in `templatesFolder`) whose content seeds new daily
  // notes. null = no template; new daily notes start empty.
  dailyNoteTemplateId: string | null

  // ── AI (BYO key) ──────────────────────────────────────────────────────
  // Which provider the aiClient targets. `'off'` (default) disables every
  // AI feature.
  aiProvider: AIProvider
  // Embeddings opt-in (a1f7). Defaults off so users don't accidentally
  // burn OpenAI tokens. Requires aiProvider === 'openai' to function;
  // the toggle is visible regardless so users discover the feature.
  aiEmbeddingsEnabled: boolean
  // AI-generated commit messages. When on, the sync flow asks
  // aiClient.runPrompt to draft a short message from the pending
  // diff (created/modified/deleted note titles + paths). Falls back
  // to the auto-generated "Sync from Noteser (N changes)" when off
  // or when the AI call fails. Costs 1 small AI call per sync.
  aiCommitMessages: boolean
  // ── Editor defaults ────────────────────────────────────────────────────
  // When true (default), opening a note lands you on rendered preview
  // mode rather than the editable source view. New users get the
  // "wow" rendered output up front; clicking pencil / pressing the
  // toggle still switches to edit. Per-device.
  notesOpenInPreviewMode: boolean
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

  // ── Ribbon ─────────────────────────────────────────────────────────────
  // User-defined order of sidebar ribbon items by id (`notes`, `recent`,
  // `calendar`, …). Items missing from this list fall back to the source
  // order in Ribbon.tsx — new items appended in a release auto-show up at
  // the end of the user's customised list without overwriting their order.
  // Empty array = default order.
  ribbonOrder: string[]

  // ── Sidebar tab strip order (s4r3 v2) ──────────────────────────────────
  // Order of panels in the lower switcher. Same merge semantics as
  // ribbonOrder — unknown ids dropped, new ids appended, empty = source
  // order. The strings here are SidebarTabId values, but we widen to
  // string[] so the store stays portable and a future-added tab id
  // doesn't break old persisted state.
  sidebarTabOrder: string[]

  // Panels pinned at the TOP of the sidebar, grouped into one mini
  // tab strip per group (Obsidian pane model). The outer array is
  // the top-to-bottom order of groups; each inner array is the tabs
  // inside that group. A single-element group renders a strip with
  // one icon; a multi-element group lets the user switch between
  // tabs in that group via icon clicks.
  // Default: [] (no pinned groups; every panel lives in the main
  // bottom strip). Users drag tabs UP to pin into a new group or
  // ONTO an existing mini-strip to join that group.
  pinnedPanels: string[][]

  // ── Onboarding ─────────────────────────────────────────────────────────
  // True once the first-run onboarding modal has been dismissed (either by
  // picking a starter vault or by skipping). We only ever flip it forward;
  // it's intentional that re-installs see the modal again.
  onboardingShown: boolean

  // ── Beta features ──────────────────────────────────────────────────────
  // Master switch. When false, every named flag in `betaFlags` is treated
  // as off regardless of its stored value. UI: a single toggle in Settings
  // → General; the per-flag list appears only when this is true.
  betaEnabled: boolean
  // Per-flag opt-ins. Keys come from `src/utils/featureFlags.ts`; values
  // are booleans. Missing key = off. See docs/beta-and-bug-reporting.md
  // for the lifecycle / when-to-remove discipline.
  betaFlags: Record<string, boolean>

  // ── Bulk-delete warning ───────────────────────────────────────────────
  // Show a confirm dialog before a multi-select delete. Defaults on for
  // safety — users can turn it off via Settings → General once they've
  // built muscle memory.
  confirmBulkDelete: boolean

  // ── Trash ──────────────────────────────────────────────────────────────
  // Controls what `deleteNote` / `cascadeDeleteFolder` do. 'trash' = the
  // existing soft-delete (recoverable via the Trash view). 'hardDelete' =
  // skip the trash and remove immediately.
  trashMode: TrashMode

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  // Per-shortcut combo override. Keys are `ShortcutDef.id` values from
  // `src/utils/shortcuts.ts`; values are canonical combo strings (e.g.
  // `Ctrl+Shift+Y`). Anything absent falls back to the shortcut's default.
  // Empty object = pristine defaults.
  shortcutOverrides: Record<string, string>

  // ── Vault settings sync (vs8x) ─────────────────────────────────────────
  // Repo-relative path of the folder that holds the vault settings file.
  // Default `.noteser` (analogous to Obsidian's `.obsidian/`). Per-DEVICE
  // — letting different devices use different paths is the escape hatch
  // from cross-device settings merge problems. Set to '' to disable
  // settings sync entirely. Settings → Sync surfaces this field.
  settingsFolderPath: string
  // Wall-clock timestamp of the last local change to ANY vault-tagged
  // setting. Used for LWW on pull. Bumped automatically by setVaultField
  // — callers don't need to touch it.
  vaultSettingsUpdatedAt: number
  // Hash of the vault slice we last successfully pushed. Used to skip
  // empty pushes (no settings changed since last sync = don't bother
  // re-uploading the file).
  vaultSettingsLastPushedHash: string

  // ── Backup encryption (bke1) ──────────────────────────────────────────
  // When true, note `.md` bodies are AES-GCM encrypted before push and
  // decrypted on pull. The DERIVED KEY is held only in memory (see
  // src/utils/vaultKey.ts); the passphrase is never persisted anywhere.
  // The 16-byte salt is shared across devices so the same passphrase
  // derives the same key everywhere.
  //
  // VAULT-SYNCED so a fresh client picking up the repo knows it needs to
  // prompt for a passphrase rather than silently treating encrypted
  // bodies as garbage markdown.
  vaultEncryptionEnabled: boolean
  // Base64-encoded 16-byte salt for PBKDF2. Generated once per vault on
  // first enabling; never rotated. null = encryption disabled OR the
  // user hasn't completed first-time setup yet.
  vaultEncryptionSalt: string | null

  // ── Custom theme (th3m) ────────────────────────────────────────────────
  // Per-token color overrides applied as CSS variables on :root at
  // runtime. Keys come from THEME_TOKEN_KEYS; values are any valid
  // CSS color string (#rrggbb, hsl(…), rgb(…), named). Empty record
  // = use the built-in defaults from globals.css.
  // VAULT-SYNCED so a user's theme follows them across devices.
  themeOverrides: Record<string, string>

  // ── Share defaults (shr2) ──────────────────────────────────────────────
  // Default expiry (days) baked into newly-generated /share URLs.
  // 0 means "no expiry" — the current legacy default. Per-device.
  shareDefaultExpiryDays: number
  // Default for the burn-after-read flag on newly-generated /share
  // URLs. When true, the recipient browser flips a localStorage key
  // on first successful decode and refuses to re-render on a revisit.
  shareDefaultBurn: boolean

  // ── Vault .gitignore overlay (gi9n) ────────────────────────────────────
  // Per-DEVICE extra gitignore patterns combined with the vault's remote
  // `.gitignore` at sync time. Lets users add a few personal ignores
  // (e.g. their own scratch files) without touching the shared file.
  // Stored verbatim — the matcher in src/utils/gitignore.ts parses it
  // along with the remote lines.
  localGitignoreOverlay: string

  // Pending edit to the vault's shared `.gitignore`. null = no pending
  // change (the next sync uses whatever is on the remote). A string
  // (incl. '') = the user clicked Save in the editor and wants this
  // pushed on the next sync, replacing the remote file. Cleared back to
  // null by useGitHubSync once the push succeeds.
  vaultGitignoreDraft: string | null
  // Snapshot of the remote `.gitignore` content captured the last time
  // the user clicked "Fetch from sync repo". Used by the editor to
  // detect unsaved local edits ("draft differs from snapshot") so the
  // UI can show a dirty marker.
  vaultGitignoreRemoteSnapshot: string | null

  setFolderSortMode: (mode: FolderSortMode) => void
  setTaskListDensity: (density: TaskListDensity) => void
  setShowHiddenFolders: (value: boolean) => void
  setAttachmentsFolder: (folder: string) => void
  setAutoSyncOnStart: (value: boolean) => void
  setAutoSyncIntervalMinutes: (minutes: number) => void
  setDailyNotesFolder: (folder: string) => void
  setDailyNoteDateFormat: (format: string) => void
  setWeeklyNotesFolder: (folder: string) => void
  setWeeklyNoteDateFormat: (format: string) => void
  setMonthlyNotesFolder: (folder: string) => void
  setMonthlyNoteDateFormat: (format: string) => void
  setTemplatesFolder: (folder: string) => void
  setDailyNoteTemplateId: (id: string | null) => void
  setAiProvider: (provider: AIProvider) => void
  setAiApiKey: (key: string) => void
  setAiModel: (model: string) => void
  setAiEmbeddingsEnabled: (enabled: boolean) => void
  setAiCommitMessages: (enabled: boolean) => void
  setNotesOpenInPreviewMode: (enabled: boolean) => void
  setShortcutOverride: (id: string, combo: string) => void
  clearShortcutOverride: (id: string) => void
  resetShortcutOverrides: () => void
  setTrashMode: (mode: TrashMode) => void
  setConfirmBulkDelete: (value: boolean) => void
  setBetaEnabled: (value: boolean) => void
  setBetaFlag: (id: string, value: boolean) => void
  setRibbonOrder: (order: string[]) => void
  setSidebarTabOrder: (order: string[]) => void
  setPinnedPanels: (panels: string[][]) => void
  setOnboardingShown: (value: boolean) => void
  setSettingsFolderPath: (path: string) => void
  setVaultSettingsLastPushedHash: (hash: string) => void
  setLocalGitignoreOverlay: (text: string) => void
  setVaultGitignoreDraft: (text: string | null) => void
  setVaultGitignoreRemoteSnapshot: (text: string | null) => void
  // Enable encryption with a fresh salt; clears salt + flag when
  // disabling. The derived key lives in `vaultKey.ts` — this setter
  // ONLY touches the persisted flag + salt.
  setVaultEncryption: (enabled: boolean, saltBase64: string | null) => void
  setShareDefaultExpiryDays: (days: number) => void
  setShareDefaultBurn: (value: boolean) => void
  setThemeOverrides: (overrides: Record<string, string>) => void
  setThemeToken: (token: string, value: string) => void
  resetThemeOverrides: () => void
  // Applies a remote vault-settings payload received via sync. Sets the
  // fields AND moves vaultSettingsUpdatedAt to the remote timestamp +
  // refreshes lastPushedHash so the next push doesn't think this is a
  // local change.
  applyRemoteVaultSettings: (
    fields: Partial<SettingsState>,
    remoteUpdatedAt: number,
    remoteHash: string,
  ) => void
  reset: () => void
}

// Single source of truth for which keys are synced via the vault
// settings file. Keep small and concrete — security-sensitive keys
// (AI API key) and device-shape keys (UI prefs, shortcuts, sync
// cadence, onboarding) STAY OUT. Adding a key here means it'll start
// round-tripping across every device that shares the same
// settingsFolderPath, so think before adding.
export const VAULT_SETTING_KEYS = [
  'folderSortMode',
  'taskListDensity',
  'showHiddenFolders',
  'attachmentsFolder',
  'dailyNotesFolder',
  'dailyNoteDateFormat',
  'weeklyNotesFolder',
  'weeklyNoteDateFormat',
  'monthlyNotesFolder',
  'monthlyNoteDateFormat',
  'templatesFolder',
  'dailyNoteTemplateId',
  'trashMode',
  'confirmBulkDelete',
  'betaEnabled',
  'betaFlags',
  'themeOverrides',
  // Encryption flag + salt are vault-synced so a fresh device picks
  // them up from the repo's settings.json and knows to unlock the vault
  // before applying remote notes.
  'vaultEncryptionEnabled',
  'vaultEncryptionSalt',
] as const

export type VaultSettingKey = (typeof VAULT_SETTING_KEYS)[number]

const DEFAULTS = {
  folderSortMode: 'alphabetical' as FolderSortMode,
  taskListDensity: 'comfortable' as TaskListDensity,
  showHiddenFolders: true,
  attachmentsFolder: 'Files',
  autoSyncOnStart: true,
  autoSyncIntervalMinutes: 0,
  dailyNotesFolder: 'Notes/Daily',
  dailyNoteDateFormat: 'YYYY-MM-DD',
  weeklyNotesFolder: 'Notes/Weekly',
  weeklyNoteDateFormat: 'YYYY-WW',
  monthlyNotesFolder: 'Notes/Monthly',
  monthlyNoteDateFormat: 'YYYY-MM',
  templatesFolder: 'Templates',
  dailyNoteTemplateId: null as string | null,
  aiProvider: 'off' as AIProvider,
  aiApiKey: '',
  aiModel: DEFAULT_AI_MODEL.anthropic,
  aiEmbeddingsEnabled: false,
  aiCommitMessages: false,
  notesOpenInPreviewMode: true,
  shortcutOverrides: {} as Record<string, string>,
  trashMode: 'trash' as TrashMode,
  confirmBulkDelete: true,
  betaEnabled: false,
  betaFlags: {} as Record<string, boolean>,
  ribbonOrder: [] as string[],
  sidebarTabOrder: [] as string[],
  // Empty by default — every panel lives as an icon in the main
  // tab strip. Users drag tabs UP to pin into a new group, or onto
  // an existing mini-strip to join that group (Obsidian pane model).
  pinnedPanels: [] as string[][],
  onboardingShown: false,
  settingsFolderPath: '.noteser',
  vaultSettingsUpdatedAt: 0,
  vaultSettingsLastPushedHash: '',
  localGitignoreOverlay: '',
  vaultGitignoreDraft: null as string | null,
  vaultGitignoreRemoteSnapshot: null as string | null,
  shareDefaultExpiryDays: 0,
  shareDefaultBurn: false,
  themeOverrides: {} as Record<string, string>,
  vaultEncryptionEnabled: false,
  vaultEncryptionSalt: null as string | null,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => {
      // Bump vaultSettingsUpdatedAt alongside any vault-tagged change so
      // LWW comparisons against the remote payload work. Device-only
      // setters call `set` directly to skip the bump.
      const setVault = (changes: Partial<SettingsState>) =>
        set({ ...changes, vaultSettingsUpdatedAt: Date.now() } as Partial<SettingsState>)
      return {
        ...DEFAULTS,
        setFolderSortMode: (folderSortMode) => setVault({ folderSortMode }),
        setTaskListDensity: (taskListDensity) => setVault({ taskListDensity }),
        setShowHiddenFolders: (showHiddenFolders) => setVault({ showHiddenFolders }),
        setAttachmentsFolder: (attachmentsFolder) => setVault({ attachmentsFolder }),
        setAutoSyncOnStart: (autoSyncOnStart) => set({ autoSyncOnStart }),
        setAutoSyncIntervalMinutes: (autoSyncIntervalMinutes) => set({ autoSyncIntervalMinutes }),
        setDailyNotesFolder: (dailyNotesFolder) => setVault({ dailyNotesFolder }),
        setDailyNoteDateFormat: (dailyNoteDateFormat) => setVault({ dailyNoteDateFormat }),
        setWeeklyNotesFolder: (weeklyNotesFolder) => setVault({ weeklyNotesFolder }),
        setWeeklyNoteDateFormat: (weeklyNoteDateFormat) => setVault({ weeklyNoteDateFormat }),
        setMonthlyNotesFolder: (monthlyNotesFolder) => setVault({ monthlyNotesFolder }),
        setMonthlyNoteDateFormat: (monthlyNoteDateFormat) => setVault({ monthlyNoteDateFormat }),
        setTemplatesFolder: (templatesFolder) => setVault({ templatesFolder }),
        setDailyNoteTemplateId: (dailyNoteTemplateId) => setVault({ dailyNoteTemplateId }),
        setAiProvider: (aiProvider) => set({ aiProvider }),
        setAiApiKey: (aiApiKey) => set({ aiApiKey }),
        setAiModel: (aiModel) => set({ aiModel }),
        setAiEmbeddingsEnabled: (aiEmbeddingsEnabled) => set({ aiEmbeddingsEnabled }),
        setAiCommitMessages: (aiCommitMessages) => set({ aiCommitMessages }),
        setNotesOpenInPreviewMode: (notesOpenInPreviewMode) => set({ notesOpenInPreviewMode }),
        setShortcutOverride: (id, combo) =>
          set((state) => ({
            shortcutOverrides: { ...state.shortcutOverrides, [id]: combo },
          })),
        clearShortcutOverride: (id) =>
          set((state) => {
            if (!(id in state.shortcutOverrides)) return state
            const next = { ...state.shortcutOverrides }
            delete next[id]
            return { shortcutOverrides: next }
          }),
        resetShortcutOverrides: () => set({ shortcutOverrides: {} }),
        setTrashMode: (trashMode) => setVault({ trashMode }),
        setConfirmBulkDelete: (confirmBulkDelete) => setVault({ confirmBulkDelete }),
        setBetaEnabled: (betaEnabled) => setVault({ betaEnabled }),
        setBetaFlag: (id, value) =>
          set((state) => ({
            betaFlags: { ...state.betaFlags, [id]: value },
            vaultSettingsUpdatedAt: Date.now(),
          })),
        setRibbonOrder: (ribbonOrder) => set({ ribbonOrder }),
        setSidebarTabOrder: (sidebarTabOrder) => set({ sidebarTabOrder }),
        setPinnedPanels: (pinnedPanels) => set({ pinnedPanels }),
        setOnboardingShown: (onboardingShown) => set({ onboardingShown }),
        setSettingsFolderPath: (path) => set({ settingsFolderPath: path }),
        setVaultSettingsLastPushedHash: (hash) => set({ vaultSettingsLastPushedHash: hash }),
        setLocalGitignoreOverlay: (localGitignoreOverlay) => set({ localGitignoreOverlay }),
        setVaultGitignoreDraft: (vaultGitignoreDraft) => set({ vaultGitignoreDraft }),
        setVaultGitignoreRemoteSnapshot: (vaultGitignoreRemoteSnapshot) => set({ vaultGitignoreRemoteSnapshot }),
        setVaultEncryption: (vaultEncryptionEnabled, vaultEncryptionSalt) =>
          setVault({ vaultEncryptionEnabled, vaultEncryptionSalt }),
        setShareDefaultExpiryDays: (shareDefaultExpiryDays) => set({ shareDefaultExpiryDays }),
        setShareDefaultBurn: (shareDefaultBurn) => set({ shareDefaultBurn }),
        // Theme is part of the vault-synced slice — going through
        // setVault keeps vaultSettingsUpdatedAt fresh so cross-device
        // sync picks up theme changes.
        setThemeOverrides: (themeOverrides) => setVault({ themeOverrides }),
        setThemeToken: (token, value) => set((state) => ({
          themeOverrides: { ...state.themeOverrides, [token]: value },
          vaultSettingsUpdatedAt: Date.now(),
        })),
        resetThemeOverrides: () => setVault({ themeOverrides: {} }),
        applyRemoteVaultSettings: (fields, remoteUpdatedAt, remoteHash) => {
          set({
            ...fields,
            vaultSettingsUpdatedAt: remoteUpdatedAt,
            vaultSettingsLastPushedHash: remoteHash,
          } as Partial<SettingsState>)
        },
        reset: () => set(DEFAULTS),
      }
    },
    {
      name: STORAGE_KEYS.settings,
      version: 2,
      // Migration ladder:
      //   v0→v1 (2026-05-20): pinnedPanels used to default to
      //     ['calendar'] so Calendar showed as a header-less pinned
      //     panel. The user-feedback fix moves Calendar to the main
      //     tab strip — installs carrying the historical default get
      //     reset to []. Custom lists kept.
      //   v1→v2 (2026-05-20): pinnedPanels widened from string[] to
      //     string[][] so each pinned panel can hold multiple tabs
      //     (drag onto a mini-strip joins it as a group). Old flat
      //     entries get wrapped as their own single-panel groups so
      //     existing pins survive.
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Partial<SettingsState> & {
          pinnedPanels?: unknown
        }
        if (version < 1) {
          // v0 had pp: string[]; we cast to unknown here so TS lets us
          // inspect the legacy shape.
          const pp = state.pinnedPanels as unknown
          if (Array.isArray(pp) && pp.length === 1 && pp[0] === 'calendar') {
            state.pinnedPanels = []
          }
        }
        if (version < 2) {
          const pp = state.pinnedPanels
          // Wrap a flat string[] into string[][] (one group per panel).
          // An already-nested array passes through untouched.
          if (Array.isArray(pp) && pp.every(item => typeof item === 'string')) {
            state.pinnedPanels = (pp as string[]).map(id => [id])
          }
        }
        return state as SettingsState
      },
    }
  )
)
