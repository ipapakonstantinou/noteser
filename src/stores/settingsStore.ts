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

// First day of the week shown in the sidebar Calendar. 0 = Sunday
// (default, US/legacy), 1 = Monday (ISO / most of Europe). Device-only
// UI pref — not vault-synced.
export type CalendarWeekStartDay = 0 | 1

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

// One leaf-style "group" inside the sidebar (Obsidian model). A group
// owns a horizontal tab strip + a single visible panel body (the
// `activeTab`). Multiple groups stack vertically. `id` is a stable
// random string so collapse state survives composition changes (the
// old `group.join(',')` key reset on every pin/unpin).
//
// `height` (px) is set by the user dragging the inter-group resize
// handle. `null` (or absent) means "use flex distribution" — the group
// fills remaining space. By convention the LAST group in the stack
// keeps height=null so any leftover space lands somewhere predictable.
// Clamped to >= MIN_GROUP_HEIGHT so a runaway drag can't hide a group.
export interface SidebarGroupState {
  id: string
  tabs: string[]
  activeTab: string | null
  collapsed: boolean
  height?: number | null
}

// Minimum height (in px) a sidebar group can be resized to. Matches the
// 80px floor used by SidebarSection — small enough to be useful, large
// enough that the strip + a sliver of body always stay visible.
export const MIN_GROUP_HEIGHT = 80

// Pure helpers shared between the left + right group setters. Each
// returns a new groups array (or the original ref when the change is a
// no-op so subscribers don't re-render). Extracted so the right-side
// setters don't re-implement the move/drop-empty logic that the left
// side has been carrying since the 2026-06-04 refactor.

export function applySetGroupActiveTab(
  groups: SidebarGroupState[], groupId: string, tabId: string,
): SidebarGroupState[] {
  const next = groups.map(g =>
    g.id === groupId && g.tabs.includes(tabId) && g.activeTab !== tabId
      ? { ...g, activeTab: tabId }
      : g,
  )
  if (next.every((g, i) => g === groups[i])) return groups
  return next
}

export function applyAddTabToGroup(
  groups: SidebarGroupState[], groupId: string, tabId: string,
): SidebarGroupState[] {
  const target = groups.find(g => g.id === groupId)
  if (!target) return groups
  if (target.tabs.includes(tabId)) {
    return groups.map(g =>
      g.id === groupId ? { ...g, activeTab: tabId } : g,
    )
  }
  const withRemoved = groups
    .map(g => g.id === groupId ? g : { ...g, tabs: g.tabs.filter(t => t !== tabId) })
    .map(g => g.tabs.length === 0 && g.id !== groupId
      ? null
      : g.activeTab && !g.tabs.includes(g.activeTab) && g.id !== groupId
        ? { ...g, activeTab: g.tabs[0] ?? null }
        : g)
    .filter((g): g is SidebarGroupState => g !== null)
  return withRemoved.map(g =>
    g.id === groupId
      ? { ...g, tabs: [...g.tabs, tabId], activeTab: tabId }
      : g,
  )
}

export function applyRemoveTabFromGroup(
  groups: SidebarGroupState[], groupId: string, tabId: string,
): SidebarGroupState[] {
  const target = groups.find(g => g.id === groupId)
  if (!target || !target.tabs.includes(tabId)) return groups
  const nextTabs = target.tabs.filter(t => t !== tabId)
  return groups
    .map(g => {
      if (g.id !== groupId) return g
      if (nextTabs.length === 0) return null
      return {
        ...g,
        tabs: nextTabs,
        activeTab: g.activeTab === tabId ? (nextTabs[0] ?? null) : g.activeTab,
      }
    })
    .filter((g): g is SidebarGroupState => g !== null)
}

export function applyCreateGroupAt(
  groups: SidebarGroupState[], insertAt: number, tabId: string,
): SidebarGroupState[] {
  const withoutTab = groups
    .map(g => ({ ...g, tabs: g.tabs.filter(t => t !== tabId) }))
    .map(g => g.activeTab && !g.tabs.includes(g.activeTab)
      ? { ...g, activeTab: g.tabs[0] ?? null }
      : g)
    .filter(g => g.tabs.length > 0)
  const newGroup: SidebarGroupState = {
    id: newSidebarGroupId(),
    tabs: [tabId],
    activeTab: tabId,
    collapsed: false,
  }
  const clamped = Math.max(0, Math.min(insertAt, withoutTab.length))
  const next = [...withoutTab]
  next.splice(clamped, 0, newGroup)
  return next
}

export function applyToggleGroupCollapsed(
  groups: SidebarGroupState[], groupId: string,
): SidebarGroupState[] {
  return groups.map(g =>
    g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
  )
}

export function applySetGroupHeight(
  groups: SidebarGroupState[], groupId: string, height: number | null,
): SidebarGroupState[] {
  const clamped =
    height == null ? null : Math.max(MIN_GROUP_HEIGHT, Math.round(height))
  const next = groups.map(g => {
    if (g.id !== groupId) return g
    if ((g.height ?? null) === clamped) return g
    return { ...g, height: clamped }
  })
  if (next.every((g, i) => g === groups[i])) return groups
  return next
}

// Crypto-strong random group id. Falls back to Math.random in the rare
// SSR/Node-without-crypto path (tests). Exported so the migration +
// the runtime "create group" helper can use the same generator.
export function newSidebarGroupId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fall through */ }
  return `g-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

export interface SettingsState {
  folderSortMode: FolderSortMode
  taskListDensity: TaskListDensity
  taskQueryLenientDoneToday: boolean
  // Show folders flagged as hidden (currently: the synthetic `attachments/`
  // folder). When false, those folders are suppressed from the sidebar.
  showHiddenFolders: boolean
  // Repo-relative folder where new attachments are saved. Empty / blank
  // falls back to the historical default `attachments`. Old refs in note
  // content continue to resolve regardless of this setting.
  attachmentsFolder: string
  // Run a sync (pull-then-push) once on app boot if a repo is connected.
  autoSyncOnStart: boolean
  // When true, the startup auto-sync runs PULL-ONLY — local edits that
  // haven't been pushed yet stay local until the user explicitly clicks
  // Commit & Sync. Useful on devices that frequently have work-in-flight
  // notes the user doesn't want auto-pushed on every boot. The pending
  // chip in EditorFooter still surfaces the unsynced count.
  // Per-DEVICE — different devices can disagree.
  pullOnlyOnStartup: boolean
  // Minutes between auto-syncs. 0 = off. Any positive integer is valid.
  autoSyncIntervalMinutes: number
  // Template used as the default commit-message when the user presses
  // Commit & Sync without typing anything. Supports `{{date}}` →
  // today's YYYY-MM-DD via `expandCommitMessage`. Same default as
  // Obsidian Git's "vault backup: {{date}}".
  defaultCommitMessage: string
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
  // Same idea for new weekly notes (2026-06-04). Parallel to
  // dailyNoteTemplateId; null = no template, new weekly notes empty.
  weeklyNoteTemplateId: string | null

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
  // When true (default), the editor opts the editable surface into the
  // device keyboard's autocorrect, capitalisation, and word suggestions
  // (spellcheck). CodeMirror leaves these OFF by default so it won't mangle
  // code or markdown; turning it on makes phone keyboards offer their
  // predictive-text strip while writing prose. Per-device — autocorrect is
  // a property of the keyboard you're typing on, not the vault.
  editorAutocorrect: boolean
  // When true (default), reopen the tabs that were open last session on
  // startup. When false, start fresh each load with an empty workspace.
  // Per-device — a startup/session preference, not vault content.
  reopenTabsOnStartup: boolean
  // First day of the week in the sidebar Calendar grid. 0 = Sunday
  // (default), 1 = Monday. Device-only UI pref — NOT vault-synced, since
  // week-start convention is a per-user/per-device display choice.
  calendarWeekStartDay: CalendarWeekStartDay
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

  // ── Sidebar groups (leaf model, 2026-06-04 v3) ─────────────────────────
  // Obsidian-style "every panel is a tab in a group" model. The sidebar
  // is a vertical stack of groups; each group has a horizontal tab strip
  // (always rendered, even for 1-tab groups) plus the active tab's body
  // below. Replaces the previous "pinned groups + one floating active
  // unpinned panel" two-zone model.
  //
  // Each group carries a STABLE random `id` (used as a drag/drop anchor
  // + collapse key) so renaming the group or reordering its tabs
  // doesn't reset collapse state the way the old `group.join(',')`
  // composite key did. `activeTab` defaults to the first tab on group
  // creation; `collapsed` defaults false.
  //
  // Default: one group with the first PANEL id ('calendar') so a fresh
  // install sees content on first load.
  sidebarGroups: SidebarGroupState[]
  // Sidebar tab ids hidden via the right-click context menu. Filtered
  // out at render time. Restored via Settings → Sidebar.
  hiddenSidebarTabs: string[]

  // ── Right sidebar groups (parity with left, 2026-06-04) ────────────────
  // Same shape as `sidebarGroups`, but holds the RIGHT-side panel ids
  // (properties, backlinks). The right registry lives in
  // components/sidebar/rightPanelRegistry.tsx. Default: one group with
  // properties so the right sidebar always has something to show on
  // first open.
  rightSidebarGroups: SidebarGroupState[]

  // ── Onboarding ─────────────────────────────────────────────────────────
  // True once the first-run onboarding modal has been dismissed (either by
  // picking a starter vault or by skipping). We only ever flip it forward;
  // it's intentional that re-installs see the modal again.
  onboardingShown: boolean

  // ── Startup note ───────────────────────────────────────────────────────
  // If set to a known note id, that note opens automatically on app
  // boot instead of (or before) the Welcome view. null = no startup
  // note → existing welcome-vs-empty behaviour. Persisted per-vault
  // alongside the other VAULT settings below.
  startupNoteId: string | null

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

  // ── Single-note trash warning ─────────────────────────────────────────
  // Show the "Move to Trash" confirm dialog when deleting a single note.
  // Defaults on (the historical behaviour). Users who delete a lot — and
  // already trust the Trash safety net — can flip this off in Settings →
  // General so a Delete keystroke (or a context-menu Delete click) moves
  // straight to trash. Bulk-delete keeps its OWN toggle
  // (`confirmBulkDelete`) so muscle memory for "Ctrl+Click selects, then
  // Delete kills the lot" doesn't accidentally graduate to "one
  // mis-keystroke nukes 47 notes".
  confirmBeforeTrash: boolean

  // ── Trash ──────────────────────────────────────────────────────────────
  // Controls what `deleteNote` / `cascadeDeleteFolder` do. 'trash' = the
  // existing soft-delete (recoverable via the Trash view). 'hardDelete' =
  // skip the trash and remove immediately.
  trashMode: TrashMode

  // Display name for the synthetic ".trash" folder in the sidebar. Purely
  // cosmetic — trashed notes reference the trash by its fixed synthetic id
  // (TRASH_FOLDER_ID), so renaming never loses anything. Defaults to
  // `.trash`.
  //
  // SYNC SEMANTICS (#178): the trash folder does NOT participate in the
  // vault tree. Trashed notes are removed from the remote on push
  // (syncPush emits a `sha: null` tree delete for their old gitPath), so
  // no trash-folder path is ever derived from this value — push/pull path
  // derivation never reads it, which is exactly why renaming is safe for
  // existing vaults. The SETTING itself round-trips across devices via
  // the vault settings file (it is in VAULT_SETTING_KEYS). A remote repo
  // that already contains a real `.trash/` folder (e.g. an imported
  // Obsidian vault) is pulled as an ordinary dot-folder, unaffected by
  // this setting. If trashed notes ever start being PUSHED under a trash
  // path instead of deleted, that code must read this field — do not
  // hardcode `.trash`.
  trashFolderName: string

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
  // Canary blob — a known plaintext encrypted with the derived key at
  // enable time. The unlock UI decrypts this with the passphrase the
  // user types and checks the result matches; if not, the passphrase
  // was wrong. Without a canary we'd only detect "wrong passphrase" on
  // the next pull's first decrypt, which is laggy and confusing.
  // Vault-synced so any device opening the vault can verify locally.
  vaultEncryptionCanary: string | null

  // ── Custom theme (th3m) ────────────────────────────────────────────────
  // Per-token color overrides applied as CSS variables on :root at
  // runtime. Keys come from THEME_TOKEN_KEYS; values are any valid
  // CSS color string (#rrggbb, hsl(…), rgb(…), named). Empty record
  // = use the built-in defaults from globals.css.
  // VAULT-SYNCED so a user's theme follows them across devices.
  themeOverrides: Record<string, string>

  // ── Fonts (fnt1) ───────────────────────────────────────────────────────
  // User-pickable font families, applied as CSS variables on :root at
  // runtime (see src/utils/fonts.ts). Each is a CSS font-family value
  // (single family name OR a full comma-separated stack). An EMPTY string
  // means "system default" — the variable is cleared and the default
  // declared in globals.css takes over, so existing users see no change
  // until they pick a font. No web-font downloads: these apply to
  // locally-installed / system fonts.
  //   fontText      → editor content + reading-mode body
  //   fontMono      → code blocks, inline code, editor/live-preview mono
  //   fontInterface → app chrome (sidebar, modals, buttons)
  // VAULT-SYNCED so a user's font choice follows them across devices.
  fontText: string
  fontMono: string
  fontInterface: string

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
  setTaskQueryLenientDoneToday: (value: boolean) => void
  setShowHiddenFolders: (value: boolean) => void
  setAttachmentsFolder: (folder: string) => void
  setAutoSyncOnStart: (value: boolean) => void
  setPullOnlyOnStartup: (value: boolean) => void
  setAutoSyncIntervalMinutes: (minutes: number) => void
  setDefaultCommitMessage: (template: string) => void
  setDailyNotesFolder: (folder: string) => void
  setDailyNoteDateFormat: (format: string) => void
  setWeeklyNotesFolder: (folder: string) => void
  setWeeklyNoteDateFormat: (format: string) => void
  setMonthlyNotesFolder: (folder: string) => void
  setMonthlyNoteDateFormat: (format: string) => void
  setTemplatesFolder: (folder: string) => void
  setDailyNoteTemplateId: (id: string | null) => void
  setWeeklyNoteTemplateId: (id: string | null) => void
  setAiProvider: (provider: AIProvider) => void
  setAiApiKey: (key: string) => void
  setAiModel: (model: string) => void
  setAiEmbeddingsEnabled: (enabled: boolean) => void
  setAiCommitMessages: (enabled: boolean) => void
  setNotesOpenInPreviewMode: (enabled: boolean) => void
  setEditorAutocorrect: (enabled: boolean) => void
  setReopenTabsOnStartup: (enabled: boolean) => void
  setCalendarWeekStartDay: (day: CalendarWeekStartDay) => void
  setShortcutOverride: (id: string, combo: string) => void
  clearShortcutOverride: (id: string) => void
  resetShortcutOverrides: () => void
  setTrashMode: (mode: TrashMode) => void
  setTrashFolderName: (name: string) => void
  setConfirmBulkDelete: (value: boolean) => void
  setConfirmBeforeTrash: (value: boolean) => void
  setBetaEnabled: (value: boolean) => void
  setBetaFlag: (id: string, value: boolean) => void
  setRibbonOrder: (order: string[]) => void
  // Replace the entire groups array. Callers that need finer-grained
  // edits should prefer the dedicated setters below; this one is the
  // escape hatch for bulk migrations / tests.
  setSidebarGroups: (groups: SidebarGroupState[]) => void
  setGroupActiveTab: (groupId: string, tabId: string) => void
  addTabToGroup: (groupId: string, tabId: string) => void
  removeTabFromGroup: (groupId: string, tabId: string) => void
  // Insert a brand-new group containing only `tabId` at position
  // `insertAt` (0 = top of stack). Removes the tab from any other
  // group it was in so the same panel never lives in two places.
  createGroupAt: (insertAt: number, tabId: string) => void
  toggleGroupCollapsed: (groupId: string) => void
  // Resize a group to a specific pixel height. Pass `null` to release
  // the explicit height and let flex distribution take over (used when
  // the user double-clicks the divider to "snap back"). Clamped to >=
  // MIN_GROUP_HEIGHT.
  setGroupHeight: (groupId: string, height: number | null) => void
  // ── Right sidebar group setters — mirror the left-side ones above.
  // Same semantics (move tab between groups, drop empty groups, etc.)
  // applied to `rightSidebarGroups`. No `hiddenRightSidebarTabs`
  // counterpart yet — the right side has so few panels that hiding
  // them would be more confusing than useful.
  setRightSidebarGroups: (groups: SidebarGroupState[]) => void
  setRightGroupActiveTab: (groupId: string, tabId: string) => void
  addTabToRightGroup: (groupId: string, tabId: string) => void
  removeTabFromRightGroup: (groupId: string, tabId: string) => void
  createRightGroupAt: (insertAt: number, tabId: string) => void
  toggleRightGroupCollapsed: (groupId: string) => void
  setRightGroupHeight: (groupId: string, height: number | null) => void
  // Adds an id to `hiddenSidebarTabs` if not present. The tab disappears
  // from every group it lived in (auto-unpin); empty groups are dropped.
  hideSidebarTab: (id: string) => void
  // Removes from `hiddenSidebarTabs`. Does NOT auto-restore to a group
  // — restoring is a separate user gesture (activity-bar click).
  showSidebarTab: (id: string) => void
  setOnboardingShown: (value: boolean) => void
  setStartupNoteId: (id: string | null) => void
  setSettingsFolderPath: (path: string) => void
  setVaultSettingsLastPushedHash: (hash: string) => void
  setLocalGitignoreOverlay: (text: string) => void
  setVaultGitignoreDraft: (text: string | null) => void
  setVaultGitignoreRemoteSnapshot: (text: string | null) => void
  // Enable encryption with a fresh salt; clears salt + flag when
  // disabling. The derived key lives in `vaultKey.ts` — this setter
  // ONLY touches the persisted flag + salt.
  setVaultEncryption: (enabled: boolean, saltBase64: string | null, canary: string | null) => void
  setShareDefaultExpiryDays: (days: number) => void
  setShareDefaultBurn: (value: boolean) => void
  setThemeOverrides: (overrides: Record<string, string>) => void
  setThemeToken: (token: string, value: string) => void
  resetThemeOverrides: () => void
  setFontText: (value: string) => void
  setFontMono: (value: string) => void
  setFontInterface: (value: string) => void
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
  'weeklyNoteTemplateId',
  'trashMode',
  'trashFolderName',
  'confirmBulkDelete',
  'betaEnabled',
  'betaFlags',
  'themeOverrides',
  'fontText',
  'fontMono',
  'fontInterface',
  // Encryption flag + salt are vault-synced so a fresh device picks
  // them up from the repo's settings.json and knows to unlock the vault
  // before applying remote notes.
  'vaultEncryptionEnabled',
  'vaultEncryptionSalt',
  'vaultEncryptionCanary',
  'defaultCommitMessage',
] as const

export type VaultSettingKey = (typeof VAULT_SETTING_KEYS)[number]

const DEFAULTS = {
  folderSortMode: 'alphabetical' as FolderSortMode,
  taskListDensity: 'comfortable' as TaskListDensity,
  taskQueryLenientDoneToday: false,
  showHiddenFolders: true,
  attachmentsFolder: 'Files',
  autoSyncOnStart: true,
  pullOnlyOnStartup: false,
  autoSyncIntervalMinutes: 0,
  defaultCommitMessage: 'Sync from Noteser ({{date}})',
  dailyNotesFolder: 'Notes/Daily',
  dailyNoteDateFormat: 'YYYY-MM-DD',
  weeklyNotesFolder: 'Notes/Weekly',
  weeklyNoteDateFormat: 'YYYY-WW',
  monthlyNotesFolder: 'Notes/Monthly',
  monthlyNoteDateFormat: 'YYYY-MM',
  templatesFolder: 'Templates',
  dailyNoteTemplateId: null as string | null,
  weeklyNoteTemplateId: null as string | null,
  aiProvider: 'off' as AIProvider,
  aiApiKey: '',
  aiModel: DEFAULT_AI_MODEL.anthropic,
  aiEmbeddingsEnabled: false,
  aiCommitMessages: false,
  notesOpenInPreviewMode: false,
  editorAutocorrect: true,
  reopenTabsOnStartup: true,
  calendarWeekStartDay: 1 as CalendarWeekStartDay,
  shortcutOverrides: {} as Record<string, string>,
  trashMode: 'trash' as TrashMode,
  trashFolderName: '.trash',
  confirmBulkDelete: true,
  confirmBeforeTrash: true,
  betaEnabled: false,
  betaFlags: {} as Record<string, boolean>,
  ribbonOrder: [] as string[],
  // Default leaf state — one group with calendar pre-loaded so a fresh
  // install sees something on first paint. The id is a stable string
  // (NOT a random UUID) so the SSR snapshot and the client snapshot
  // match — random ids would trigger a hydration warning on the
  // very first render before persist rehydrates with the same default.
  // Once the user touches anything, real UUIDs take over via the
  // helpers in sidebarGroupActions.ts.
  // Two-group default layout matching Obsidian's expected first-run
  // (per user feedback 2026-06-04). Group 1 leads with the calendar /
  // plugins / search trio; Group 2 holds the file-browsing + writing
  // panels. Both group ids are stable strings so SSR + the very-first
  // client render produce identical output. Once the user touches
  // anything, real UUIDs take over via sidebarGroupActions.ts.
  sidebarGroups: [
    {
      id: 'default-top',
      tabs: ['calendar', 'plugins', 'search'],
      activeTab: 'calendar',
      collapsed: false,
    },
    {
      id: 'default-bottom',
      tabs: ['files', 'outline', 'source-control', 'bookmarks', 'related'],
      activeTab: 'files',
      collapsed: false,
    },
  ] as SidebarGroupState[],
  // Sidebar tab ids the user has hidden via the right-click context
  // menu. Hidden tabs are filtered out of every group's strip at
  // render time. They can be restored via Settings → Sidebar.
  hiddenSidebarTabs: [] as string[],
  // Default RIGHT-side stack — one group containing Properties so the
  // right sidebar shows note metadata as soon as the user opens it.
  // Stable id so SSR + first-client render match.
  rightSidebarGroups: [
    { id: 'right-default', tabs: ['properties'], activeTab: 'properties', collapsed: false },
  ] as SidebarGroupState[],
  onboardingShown: false,
  startupNoteId: null as string | null,
  settingsFolderPath: '.noteser',
  vaultSettingsUpdatedAt: 0,
  vaultSettingsLastPushedHash: '',
  localGitignoreOverlay: '',
  vaultGitignoreDraft: null as string | null,
  vaultGitignoreRemoteSnapshot: null as string | null,
  shareDefaultExpiryDays: 0,
  shareDefaultBurn: false,
  themeOverrides: {} as Record<string, string>,
  // Empty = system default (see src/utils/fonts.ts). Defaults reproduce
  // today's appearance exactly.
  fontText: '',
  fontMono: '',
  fontInterface: '',
  vaultEncryptionEnabled: false,
  vaultEncryptionSalt: null as string | null,
  vaultEncryptionCanary: null as string | null,
}

// Migration helper — exported so the migration test and the uiStore's
// own migration (which knows about the legacy sidebarTabId) can call
// it directly. Maps the old "pinned groups + floating unpinned panel"
// model onto the new leaf-model groups array.
//
//   - Each entry in `pinnedPanels` becomes one SidebarGroupState.
//     The group's `activeTab` defaults to its first tab (Obsidian's
//     same default).
//   - `collapsedPinnedGroups` entries map via `group.join(',')` — if
//     the migrated group's key matches, set `collapsed: true`.
//   - Stable random ids per group so subsequent collapse toggles
//     don't reset state.
//
// The optional `extraTrailingTab` lets the uiStore migration pass in
// `sidebarTabId` (the old "active unpinned panel") so it survives as a
// trailing group. We skip it when it already lives in some pinned
// group or in the hidden list to avoid duplicates.
export function legacyToSidebarGroups(
  pinnedPanels: string[][] | undefined,
  collapsedPinnedGroups: string[] | undefined,
  extraTrailingTab?: string | null,
  hiddenSidebarTabs?: string[],
): SidebarGroupState[] {
  const collapsedKeys = new Set(collapsedPinnedGroups ?? [])
  const groups: SidebarGroupState[] = []
  const seen = new Set<string>()
  if (Array.isArray(pinnedPanels)) {
    for (const group of pinnedPanels) {
      if (!Array.isArray(group)) continue
      const tabs: string[] = []
      for (const id of group) {
        if (typeof id === 'string' && !seen.has(id)) {
          tabs.push(id)
          seen.add(id)
        }
      }
      if (tabs.length === 0) continue
      groups.push({
        id: newSidebarGroupId(),
        tabs,
        activeTab: tabs[0],
        collapsed: collapsedKeys.has(tabs.join(',')),
      })
    }
  }
  const hidden = new Set(hiddenSidebarTabs ?? [])
  if (extraTrailingTab && !seen.has(extraTrailingTab) && !hidden.has(extraTrailingTab)) {
    groups.push({
      id: newSidebarGroupId(),
      tabs: [extraTrailingTab],
      activeTab: extraTrailingTab,
      collapsed: false,
    })
  }
  // Empty-source guard: a fresh install with no legacy fields would
  // produce zero groups, which is fine — DEFAULTS.sidebarGroups
  // covers that path via the persist default merge. We return [] so
  // the caller can decide whether to fall back to the default.
  return groups
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
        setTaskQueryLenientDoneToday: (taskQueryLenientDoneToday) => set({ taskQueryLenientDoneToday }),
        setShowHiddenFolders: (showHiddenFolders) => setVault({ showHiddenFolders }),
        setAttachmentsFolder: (attachmentsFolder) => setVault({ attachmentsFolder }),
        setAutoSyncOnStart: (autoSyncOnStart) => set({ autoSyncOnStart }),
        setPullOnlyOnStartup: (pullOnlyOnStartup) => set({ pullOnlyOnStartup }),
        setAutoSyncIntervalMinutes: (autoSyncIntervalMinutes) => set({ autoSyncIntervalMinutes }),
        setDefaultCommitMessage: (defaultCommitMessage) => setVault({ defaultCommitMessage }),
        setDailyNotesFolder: (dailyNotesFolder) => setVault({ dailyNotesFolder }),
        setDailyNoteDateFormat: (dailyNoteDateFormat) => setVault({ dailyNoteDateFormat }),
        setWeeklyNotesFolder: (weeklyNotesFolder) => setVault({ weeklyNotesFolder }),
        setWeeklyNoteDateFormat: (weeklyNoteDateFormat) => setVault({ weeklyNoteDateFormat }),
        setMonthlyNotesFolder: (monthlyNotesFolder) => setVault({ monthlyNotesFolder }),
        setMonthlyNoteDateFormat: (monthlyNoteDateFormat) => setVault({ monthlyNoteDateFormat }),
        setTemplatesFolder: (templatesFolder) => setVault({ templatesFolder }),
        setDailyNoteTemplateId: (dailyNoteTemplateId) => setVault({ dailyNoteTemplateId }),
        setWeeklyNoteTemplateId: (weeklyNoteTemplateId) => setVault({ weeklyNoteTemplateId }),
        setAiProvider: (aiProvider) => set({ aiProvider }),
        setAiApiKey: (aiApiKey) => set({ aiApiKey }),
        setAiModel: (aiModel) => set({ aiModel }),
        setAiEmbeddingsEnabled: (aiEmbeddingsEnabled) => set({ aiEmbeddingsEnabled }),
        setAiCommitMessages: (aiCommitMessages) => set({ aiCommitMessages }),
        setNotesOpenInPreviewMode: (notesOpenInPreviewMode) => set({ notesOpenInPreviewMode }),
        setEditorAutocorrect: (editorAutocorrect) => set({ editorAutocorrect }),
        setReopenTabsOnStartup: (reopenTabsOnStartup) => set({ reopenTabsOnStartup }),
        setCalendarWeekStartDay: (calendarWeekStartDay) => set({ calendarWeekStartDay }),
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
        setTrashFolderName: (trashFolderName) => setVault({ trashFolderName }),
        setConfirmBulkDelete: (confirmBulkDelete) => setVault({ confirmBulkDelete }),
        // Device-only — same logic as `confirmBulkDelete` lives in the
        // vault slice, but the single-note toggle is per-DEVICE because
        // muscle memory is a property of how the user uses THIS device's
        // keyboard, not a shared vault preference. Skip the vault bump.
        setConfirmBeforeTrash: (confirmBeforeTrash) => set({ confirmBeforeTrash }),
        setBetaEnabled: (betaEnabled) => setVault({ betaEnabled }),
        setBetaFlag: (id, value) =>
          set((state) => ({
            betaFlags: { ...state.betaFlags, [id]: value },
            vaultSettingsUpdatedAt: Date.now(),
          })),
        setRibbonOrder: (ribbonOrder) => set({ ribbonOrder }),
        setSidebarGroups: (sidebarGroups) => set({ sidebarGroups }),
        setGroupActiveTab: (groupId, tabId) =>
          set((state) => {
            const next = applySetGroupActiveTab(state.sidebarGroups, groupId, tabId)
            // Same-ref short-circuit so subscribers don't re-render on
            // a no-op (clicking an already-active tab).
            return next === state.sidebarGroups ? state : { sidebarGroups: next }
          }),
        addTabToGroup: (groupId, tabId) =>
          set((state) => {
            const next = applyAddTabToGroup(state.sidebarGroups, groupId, tabId)
            return next === state.sidebarGroups ? state : { sidebarGroups: next }
          }),
        removeTabFromGroup: (groupId, tabId) =>
          set((state) => {
            const next = applyRemoveTabFromGroup(state.sidebarGroups, groupId, tabId)
            return next === state.sidebarGroups ? state : { sidebarGroups: next }
          }),
        createGroupAt: (insertAt, tabId) =>
          set((state) => ({
            sidebarGroups: applyCreateGroupAt(state.sidebarGroups, insertAt, tabId),
          })),
        toggleGroupCollapsed: (groupId) =>
          set((state) => ({
            sidebarGroups: applyToggleGroupCollapsed(state.sidebarGroups, groupId),
          })),
        setGroupHeight: (groupId, height) =>
          set((state) => {
            const next = applySetGroupHeight(state.sidebarGroups, groupId, height)
            return next === state.sidebarGroups ? state : { sidebarGroups: next }
          }),
        // Right-side setters — mirror the left-side ones, swapping the
        // target field. Same helpers so behaviour (move semantics,
        // drop empty groups, …) stays in lockstep without copy-paste.
        setRightSidebarGroups: (rightSidebarGroups) => set({ rightSidebarGroups }),
        setRightGroupActiveTab: (groupId, tabId) =>
          set((state) => {
            const next = applySetGroupActiveTab(state.rightSidebarGroups, groupId, tabId)
            return next === state.rightSidebarGroups ? state : { rightSidebarGroups: next }
          }),
        addTabToRightGroup: (groupId, tabId) =>
          set((state) => {
            const next = applyAddTabToGroup(state.rightSidebarGroups, groupId, tabId)
            return next === state.rightSidebarGroups ? state : { rightSidebarGroups: next }
          }),
        removeTabFromRightGroup: (groupId, tabId) =>
          set((state) => {
            const next = applyRemoveTabFromGroup(state.rightSidebarGroups, groupId, tabId)
            return next === state.rightSidebarGroups ? state : { rightSidebarGroups: next }
          }),
        createRightGroupAt: (insertAt, tabId) =>
          set((state) => ({
            rightSidebarGroups: applyCreateGroupAt(state.rightSidebarGroups, insertAt, tabId),
          })),
        toggleRightGroupCollapsed: (groupId) =>
          set((state) => ({
            rightSidebarGroups: applyToggleGroupCollapsed(state.rightSidebarGroups, groupId),
          })),
        setRightGroupHeight: (groupId, height) =>
          set((state) => {
            const next = applySetGroupHeight(state.rightSidebarGroups, groupId, height)
            return next === state.rightSidebarGroups ? state : { rightSidebarGroups: next }
          }),
        hideSidebarTab: (id) =>
          set((state) => {
            if (state.hiddenSidebarTabs.includes(id)) return state
            // Auto-unpin: remove the id from every group it lives in,
            // dropping empty groups. Keeps sidebarGroups honest so
            // re-showing the tab later doesn't resurrect it in a
            // half-baked group.
            const sidebarGroups = state.sidebarGroups
              .map(g => {
                if (!g.tabs.includes(id)) return g
                const nextTabs = g.tabs.filter(t => t !== id)
                if (nextTabs.length === 0) return null
                return {
                  ...g,
                  tabs: nextTabs,
                  activeTab: g.activeTab === id ? (nextTabs[0] ?? null) : g.activeTab,
                }
              })
              .filter((g): g is SidebarGroupState => g !== null)
            return {
              hiddenSidebarTabs: [...state.hiddenSidebarTabs, id],
              sidebarGroups,
            }
          }),
        showSidebarTab: (id) =>
          set((state) => ({
            hiddenSidebarTabs: state.hiddenSidebarTabs.filter(t => t !== id),
          })),
        setOnboardingShown: (onboardingShown) => set({ onboardingShown }),
        setStartupNoteId: (startupNoteId) => set({ startupNoteId }),
        setSettingsFolderPath: (path) => set({ settingsFolderPath: path }),
        setVaultSettingsLastPushedHash: (hash) => set({ vaultSettingsLastPushedHash: hash }),
        setLocalGitignoreOverlay: (localGitignoreOverlay) => set({ localGitignoreOverlay }),
        setVaultGitignoreDraft: (vaultGitignoreDraft) => set({ vaultGitignoreDraft }),
        setVaultGitignoreRemoteSnapshot: (vaultGitignoreRemoteSnapshot) => set({ vaultGitignoreRemoteSnapshot }),
        setVaultEncryption: (vaultEncryptionEnabled, vaultEncryptionSalt, vaultEncryptionCanary) =>
          setVault({ vaultEncryptionEnabled, vaultEncryptionSalt, vaultEncryptionCanary }),
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
        // Fonts are part of the vault-synced slice — going through
        // setVault keeps vaultSettingsUpdatedAt fresh so cross-device
        // sync picks up font changes.
        setFontText: (fontText) => setVault({ fontText }),
        setFontMono: (fontMono) => setVault({ fontMono }),
        setFontInterface: (fontInterface) => setVault({ fontInterface }),
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
      version: 3,
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
      //   v2→v3 (2026-06-04): switched to the Obsidian leaf model.
      //     pinnedPanels + sidebarTabId + sidebarTabOrder +
      //     collapsedPinnedGroups collapse into a single
      //     sidebarGroups: SidebarGroupState[] field. Each old pinned
      //     group becomes one entry with a fresh stable id; collapse
      //     state migrates via the old `group.join(',')` lookup. If
      //     the old `sidebarTabId` (held in uiStore localStorage, NOT
      //     this slice) named a panel that wasn't pinned and isn't
      //     hidden, callers can append it as a trailing group — but
      //     that field lives in a different persisted key, so the
      //     migration here only covers what's in THIS slice.
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Partial<SettingsState> & {
          pinnedPanels?: unknown
          sidebarTabOrder?: unknown
          collapsedPinnedGroups?: unknown
          sidebarGroups?: unknown
        }
        if (version < 1) {
          const pp = state.pinnedPanels as unknown
          if (Array.isArray(pp) && pp.length === 1 && pp[0] === 'calendar') {
            state.pinnedPanels = []
          }
        }
        if (version < 2) {
          const pp = state.pinnedPanels
          if (Array.isArray(pp) && pp.every(item => typeof item === 'string')) {
            state.pinnedPanels = (pp as string[]).map(id => [id])
          }
        }
        if (version < 3) {
          // The uiStore migration writes the legacy `sidebarTabId`
          // into window.localStorage[__noteser_legacy_sidebar_tab_id]
          // before this slice rehydrates (best-effort — the two
          // stores rehydrate independently). Read it here so the
          // floating active unpinned panel survives as a trailing
          // group; clear it after consumption.
          let legacyActive: string | null = null
          try {
            if (typeof window !== 'undefined') {
              legacyActive = window.localStorage.getItem('__noteser_legacy_sidebar_tab_id') || null
              if (legacyActive) {
                window.localStorage.removeItem('__noteser_legacy_sidebar_tab_id')
              }
            }
          } catch { /* ignore — non-browser env */ }
          const groups = legacyToSidebarGroups(
            state.pinnedPanels as string[][] | undefined,
            state.collapsedPinnedGroups as string[] | undefined,
            legacyActive,
            state.hiddenSidebarTabs as string[] | undefined,
          )
          // Fall back to the default group if migration produced
          // nothing — a totally blank sidebar would be a worse
          // experience than the new-install default of a Calendar
          // group.
          state.sidebarGroups = groups.length > 0
            ? groups
            : [{ id: 'default', tabs: ['calendar'], activeTab: 'calendar', collapsed: false }]
          // Wipe the legacy fields. They were never vault-synced, so
          // forgetting them here is safe — the user just loses the
          // device-only "saved tab order" for the now-defunct bottom
          // strip, which is intentional (there is no bottom strip).
          delete (state as Record<string, unknown>).pinnedPanels
          delete (state as Record<string, unknown>).sidebarTabOrder
          delete (state as Record<string, unknown>).collapsedPinnedGroups
        }
        return state as SettingsState
      },
    }
  )
)
