'use client'

import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react'
import {
  CogIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  CalendarDaysIcon,
  PaperClipIcon,
  DocumentDuplicateIcon,
  CloudIcon,
  SparklesIcon,
  CommandLineIcon,
  ArrowDownTrayIcon,
  InformationCircleIcon,
  BeakerIcon,
  SwatchIcon,
  ViewColumnsIcon,
  EyeIcon,
} from '@heroicons/react/24/outline'
import { PANELS } from '@/components/sidebar/sidebarPanelRegistry'
import { THEME_TOKENS, THEME_PRESETS } from '@/utils/theme'
import { useUIStore, useSettingsStore, useGitHubStore } from '@/stores'
import type { FolderSortMode, TaskListDensity } from '@/stores'
import type { TrashMode } from '@/stores/settingsStore'
import { Modal, Button } from '@/components/ui'
import { useGitHubSync } from '@/hooks/useGitHubSync'
import { AttachmentsSection } from './AttachmentsSection'
import { AISection } from './AISection'
import { DailyNotesSection, TemplatesSection } from './DailyNotesSection'
import { ExportSection } from './ExportSection'
import { ShortcutsSection } from './ShortcutsSection'
import { FLAGS } from '@/utils/featureFlags'
import {
  Field,
  SettingsSelect,
  SettingsCheckbox,
  SettingsTextInput,
  SettingsFooter,
} from './settings'

// One row in the left-side category navigator. Order here drives the
// rendering order of the list AND the keyboard up/down nav (later).
type CategoryId =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'sidebar'
  | 'attachments'
  | 'daily-notes'
  | 'templates'
  | 'github'
  | 'ai'
  | 'shortcuts'
  | 'export'
  | 'beta'
  | 'about'

interface CategoryDef {
  id: CategoryId
  label: string
  // Lucide-style icons from heroicons; sized 18px inline.
  Icon: typeof CogIcon
}

const CATEGORIES: readonly CategoryDef[] = [
  { id: 'general',     label: 'General',     Icon: CogIcon },
  { id: 'appearance',  label: 'Appearance',  Icon: SwatchIcon },
  { id: 'editor',      label: 'Editor',      Icon: PencilSquareIcon },
  { id: 'sidebar',     label: 'Sidebar',     Icon: ViewColumnsIcon },
  { id: 'attachments', label: 'Attachments', Icon: PaperClipIcon },
  { id: 'daily-notes', label: 'Daily notes', Icon: CalendarDaysIcon },
  { id: 'templates',   label: 'Templates',   Icon: DocumentDuplicateIcon },
  { id: 'github',      label: 'GitHub sync', Icon: CloudIcon },
  { id: 'ai',          label: 'AI',          Icon: SparklesIcon },
  { id: 'shortcuts',   label: 'Shortcuts',   Icon: CommandLineIcon },
  { id: 'export',      label: 'Export',      Icon: ArrowDownTrayIcon },
  { id: 'beta',        label: 'Beta',        Icon: BeakerIcon },
  { id: 'about',       label: 'About',       Icon: InformationCircleIcon },
]

export const SettingsModal = () => {
  const { modal, closeModal } = useUIStore()
  const isOpen = modal.type === 'settings'

  // Remembers the active category for the lifetime of the modal. Reset
  // when the modal re-opens via `key={modal.type}` on the inner panel —
  // not strictly necessary but it keeps the default predictable.
  const [active, setActive] = useState<CategoryId>('general')

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title="Settings"
      size="3xl"
      bodyless
    >
      <div className="flex flex-row h-[70dvh] min-h-[480px]">
        {/* ── Left rail: category navigator ─────────────────────────── */}
        <nav
          aria-label="Settings categories"
          className="w-52 flex-none border-r border-obsidianBorder bg-obsidianBlack/40 overflow-y-auto py-2"
          data-testid="settings-categories"
        >
          {CATEGORIES.map(cat => {
            const isActive = cat.id === active
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActive(cat.id)}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`settings-cat-${cat.id}`}
                className={[
                  'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                  isActive
                    ? 'bg-obsidianAccentPurple/15 text-obsidianText border-l-2 border-obsidianAccentPurple pl-[10px]'
                    : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText border-l-2 border-transparent pl-[10px]',
                ].join(' ')}
              >
                <cat.Icon className="w-4 h-4 flex-none" />
                <span className="truncate">{cat.label}</span>
              </button>
            )
          })}
        </nav>

        {/* ── Right pane: selected category content ─────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            className="flex-1 min-h-0 overflow-y-auto p-5"
            data-testid={`settings-panel-${active}`}
          >
            <CategoryPanel id={active} />
          </div>
          <SettingsFooterBar />
        </div>
      </div>
    </Modal>
  )
}

// Renders the body for a given category. Split out so each branch can
// scope its own store subscriptions — the modal shell stays tiny and
// re-renders only on category switch, not on every settings change.
function CategoryPanel({ id }: { id: CategoryId }): ReactNode {
  switch (id) {
    case 'general':     return <GeneralPanel />
    case 'appearance':  return <AppearancePanel />
    case 'editor':      return <EditorPanel />
    case 'sidebar':     return <SidebarPanel />
    case 'attachments': return <AttachmentsSection />
    case 'daily-notes': return <DailyNotesSection />
    case 'templates':   return <TemplatesSection />
    case 'github':      return <GitHubPanel />
    case 'ai':          return <AISection />
    case 'shortcuts':   return <ShortcutsSection />
    case 'export':      return <ExportSection />
    case 'beta':        return <BetaPanel />
    case 'about':       return <AboutPanel />
  }
}

// ── Panels (kept here because they're thin wrappers over Field + store) ─

function GeneralPanel() {
  const folderSortMode = useSettingsStore(s => s.folderSortMode)
  const showHiddenFolders = useSettingsStore(s => s.showHiddenFolders)
  const trashMode = useSettingsStore(s => s.trashMode)
  const confirmBulkDelete = useSettingsStore(s => s.confirmBulkDelete)
  const shareDefaultExpiryDays = useSettingsStore(s => s.shareDefaultExpiryDays)
  const shareDefaultBurn = useSettingsStore(s => s.shareDefaultBurn)
  const setFolderSortMode = useSettingsStore(s => s.setFolderSortMode)
  const setShowHiddenFolders = useSettingsStore(s => s.setShowHiddenFolders)
  const setTrashMode = useSettingsStore(s => s.setTrashMode)
  const setConfirmBulkDelete = useSettingsStore(s => s.setConfirmBulkDelete)
  const setShareDefaultExpiryDays = useSettingsStore(s => s.setShareDefaultExpiryDays)
  const setShareDefaultBurn = useSettingsStore(s => s.setShareDefaultBurn)

  return (
    <div className="space-y-4">
      <PanelHeading>General</PanelHeading>
      <Field
        label="Sort notes within folders"
        description="How notes are ordered in the sidebar. Manual = insertion order."
      >
        <SettingsSelect<FolderSortMode>
          value={folderSortMode}
          onChange={setFolderSortMode}
          options={[
            { value: 'alphabetical', label: 'Alphabetical (A → Z)' },
            { value: 'modified', label: 'Last modified (newest first)' },
            { value: 'created', label: 'Date created (newest first)' },
            { value: 'manual', label: 'Manual (insertion order)' },
          ]}
        />
      </Field>
      <Field
        label="Show hidden folders"
        description="Folders whose name starts with a dot (`.obsidian`, `.github`, …). Turn off to suppress them from the sidebar."
      >
        <SettingsCheckbox
          checked={showHiddenFolders}
          onChange={setShowHiddenFolders}
        />
      </Field>
      <Field
        label="Delete behaviour"
        description="What happens when you delete a note. Trash keeps it recoverable via the Trash view. No trash deletes immediately."
      >
        <SettingsSelect<TrashMode>
          value={trashMode}
          onChange={setTrashMode}
          options={[
            { value: 'trash', label: 'Move to trash (recoverable)' },
            { value: 'hardDelete', label: 'Delete immediately (no trash)' },
          ]}
        />
      </Field>
      <Field
        label="Confirm before bulk delete"
        description="Show a confirm dialog when deleting multiple notes via the sidebar's multi-select (Ctrl/Cmd+Click). Turn off if you trust your aim."
      >
        <SettingsCheckbox
          checked={confirmBulkDelete}
          onChange={setConfirmBulkDelete}
        />
      </Field>

      {/* Share defaults (shr2). Both fields piggy-back on the General
          panel because they're tiny — a dedicated "Sharing" category
          can graduate them later if more options accumulate. */}
      <div className="pt-3 mt-3 border-t border-obsidianBorder space-y-3">
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
          Sharing
        </div>
        <Field
          label="Default expiry"
          description="Days until newly-generated /share links stop rendering. 0 = no expiry. Recipient browser enforces, so it's an honor-system check, not a server-revoke."
        >
          <div className="flex items-center gap-2">
            <SettingsTextInput
              value={String(shareDefaultExpiryDays)}
              onCommit={(raw) => {
                const n = parseInt(raw, 10)
                const clamped = isNaN(n) || n < 0 ? 0 : Math.min(n, 3650)
                setShareDefaultExpiryDays(clamped)
              }}
              normalize={(raw) => {
                const n = parseInt(raw, 10)
                const clamped = isNaN(n) || n < 0 ? 0 : Math.min(n, 3650)
                return String(clamped)
              }}
              placeholder="0"
              mono
            />
            <span className="text-sm text-obsidianMuted">days</span>
          </div>
        </Field>
        <Field
          label="Burn after first view"
          description="Mark /share links so the recipient's browser refuses to re-render after the first successful view. Best-effort: another device opening the same URL will still see it once."
        >
          <SettingsCheckbox
            checked={shareDefaultBurn}
            onChange={setShareDefaultBurn}
          />
        </Field>
      </div>

      {/* First-run / onboarding. Lets users re-open the Welcome tab
          after they've dismissed it — the tab no longer auto-opens
          once onboardingShown=true. */}
      <div className="pt-3 mt-3 border-t border-obsidianBorder space-y-3">
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
          First run
        </div>
        <ShowWelcomeButton />
      </div>
    </div>
  )
}

// Small action: open (or focus, if already open) the Welcome tab.
// Closes the Settings modal afterwards so the user lands on the tab.
function ShowWelcomeButton() {
  const closeModal = useUIStore(s => s.closeModal)
  return (
    <Field
      label="Show welcome tab"
      description="Reopens the Welcome tab with the feature-tour link, starter vaults, and getting-started shortcuts."
    >
      <button
        type="button"
        onClick={() => {
          // Avoid a static import cycle (settings panel ↔ workspace store
          // are loaded together). Dynamic import is fine — single click.
          import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
            useWorkspaceStore.getState().openWelcome()
            closeModal()
          })
        }}
        data-testid="settings-show-welcome"
        className="px-3 py-1.5 text-sm rounded border border-obsidianBorder bg-obsidianDarkGray text-obsidianText hover:border-obsidianAccentPurple hover:bg-obsidianHighlight/40 transition-colors"
      >
        Show welcome tab
      </button>
    </Field>
  )
}

function AppearancePanel() {
  const overrides = useSettingsStore(s => s.themeOverrides)
  const setThemeToken = useSettingsStore(s => s.setThemeToken)
  const setThemeOverrides = useSettingsStore(s => s.setThemeOverrides)
  const resetThemeOverrides = useSettingsStore(s => s.resetThemeOverrides)

  // Read the live computed value off :root when no override is set
  // so the color picker shows the actual rendered color, not just
  // the hard-coded default. Falls back to the token's
  // defaultColor when SSR / no DOM.
  const getEffective = (cssVar: string, fallback: string): string => {
    const ov = overrides?.[cssVar]
    if (ov) return ov
    if (typeof document === 'undefined') return fallback
    const computed = getComputedStyle(document.documentElement).getPropertyValue(`--${cssVar}`).trim()
    return computed || fallback
  }

  return (
    <div className="space-y-4" data-testid="settings-panel-appearance">
      <PanelHeading>Appearance</PanelHeading>
      <p className="text-xs text-obsidianSecondaryText -mt-2">
        Pick a preset or tweak individual colors. Changes apply
        instantly and sync across devices via your vault settings file.
      </p>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
          Presets
        </div>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setThemeOverrides(preset.overrides)}
              title={preset.description}
              data-testid={`theme-preset-${preset.id}`}
              className="px-3 py-1.5 text-sm rounded border border-obsidianBorder bg-obsidianDarkGray hover:bg-obsidianHighlight text-obsidianText"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 pt-3 mt-3 border-t border-obsidianBorder">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
            Individual tokens
          </div>
          <button
            type="button"
            onClick={resetThemeOverrides}
            className="text-xs text-obsidianAccentPurple hover:underline"
            data-testid="theme-reset"
          >
            Reset all
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {THEME_TOKENS.map(token => {
            const value = getEffective(token.cssVar, token.defaultColor)
            return (
              <label
                key={token.cssVar}
                className="flex items-center gap-2 text-sm text-obsidianText"
              >
                <input
                  type="color"
                  // <input type=color> requires a 7-char #rrggbb. If
                  // the effective color is an hsl()/named/8-char hex
                  // we coerce to a safe default for the picker; the
                  // actual stored override stays in the original
                  // format until the user picks a new value.
                  value={normalizeForPicker(value, token.defaultColor)}
                  onChange={e => setThemeToken(token.cssVar, e.target.value)}
                  className="w-8 h-8 rounded border border-obsidianBorder bg-transparent cursor-pointer"
                  data-testid={`theme-input-${token.cssVar}`}
                />
                <span className="flex-1 truncate">{token.label}</span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// <input type=color> needs a 7-char #rrggbb. Anything else (hsl(),
// named, 8-char alpha hex) falls back to the token's defaultColor
// so the picker stays sensible.
function normalizeForPicker(value: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  return /^#[0-9a-f]{6}$/i.test(fallback) ? fallback : '#000000'
}

function EditorPanel() {
  const taskListDensity = useSettingsStore(s => s.taskListDensity)
  const setTaskListDensity = useSettingsStore(s => s.setTaskListDensity)
  const notesOpenInPreviewMode = useSettingsStore(s => s.notesOpenInPreviewMode)
  const setNotesOpenInPreviewMode = useSettingsStore(s => s.setNotesOpenInPreviewMode)

  return (
    <div className="space-y-4">
      <PanelHeading>Editor</PanelHeading>
      <Field
        label="Open notes in preview mode"
        description="When ON (default), clicking a note opens the rendered markdown — the way readers see it. Toggle to edit mode any time with the pencil icon in the editor header."
      >
        <SettingsCheckbox
          checked={notesOpenInPreviewMode}
          onChange={setNotesOpenInPreviewMode}
        />
      </Field>
      <Field
        label="Task list density"
        description='Spacing inside `tasks` query blocks. "Comfortable" matches Obsidian; "Compact" is the legacy noteser default.'
      >
        <SettingsSelect<TaskListDensity>
          value={taskListDensity}
          onChange={setTaskListDensity}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
          ]}
        />
      </Field>
    </div>
  )
}

function SidebarPanel() {
  const hiddenSidebarTabs = useSettingsStore(s => s.hiddenSidebarTabs)
  const showSidebarTab = useSettingsStore(s => s.showSidebarTab)
  // Resolve hidden ids to panel definitions so we can show their label
  // + icon. Unknown ids (stale entries from a removed panel) are dropped.
  const hiddenPanels = hiddenSidebarTabs
    .map(id => PANELS.find(p => p.id === id))
    .filter((p): p is (typeof PANELS)[number] => Boolean(p))

  return (
    <div className="space-y-5">
      <PanelHeading>Sidebar tabs</PanelHeading>
      <p className="text-sm text-obsidianSecondaryText">
        Hide tabs you don&apos;t use from the sidebar strip by right-clicking
        the icon. Hidden tabs show up here — click &ldquo;Show&rdquo; to
        restore them. Hidden tabs are auto-unpinned and rejoin the bottom
        strip in their default position.
      </p>

      {hiddenPanels.length === 0 ? (
        <div className="text-sm text-obsidianSecondaryText italic px-2 py-3 border border-obsidianBorder rounded">
          No hidden tabs. Right-click any sidebar tab icon to hide it.
        </div>
      ) : (
        <div
          className="border border-obsidianBorder rounded divide-y divide-obsidianBorder"
          data-testid="settings-hidden-tabs"
        >
          {hiddenPanels.map(p => {
            const Icon = p.Icon
            return (
              <div
                key={p.id}
                className="flex items-center justify-between px-3 py-2"
                data-testid={`settings-hidden-tab-${p.id}`}
              >
                <span className="flex items-center gap-2 text-sm text-obsidianText">
                  <Icon className="w-4 h-4 text-obsidianSecondaryText" />
                  {p.title}
                </span>
                <button
                  type="button"
                  onClick={() => showSidebarTab(p.id)}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-obsidianAccentPurple hover:bg-obsidianHighlight rounded transition-colors"
                  data-testid={`settings-show-tab-${p.id}`}
                >
                  <EyeIcon className="w-3.5 h-3.5" />
                  Show
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GitHubPanel() {
  const autoSyncOnStart = useSettingsStore(s => s.autoSyncOnStart)
  const pullOnlyOnStartup = useSettingsStore(s => s.pullOnlyOnStartup)
  const autoSyncIntervalMinutes = useSettingsStore(s => s.autoSyncIntervalMinutes)
  const setAutoSyncOnStart = useSettingsStore(s => s.setAutoSyncOnStart)
  const setPullOnlyOnStartup = useSettingsStore(s => s.setPullOnlyOnStartup)
  const setAutoSyncIntervalMinutes = useSettingsStore(s => s.setAutoSyncIntervalMinutes)
  const settingsFolderPath = useSettingsStore(s => s.settingsFolderPath)
  const setSettingsFolderPath = useSettingsStore(s => s.setSettingsFolderPath)

  return (
    <div className="space-y-4">
      <PanelHeading>GitHub sync</PanelHeading>
      <Field
        label="Auto-sync on startup"
        description="When the app boots and a repo is connected, pull + push once automatically."
      >
        <SettingsCheckbox
          checked={autoSyncOnStart}
          onChange={setAutoSyncOnStart}
        />
      </Field>
      <Field
        label="Pull-only on startup"
        description="When auto-sync runs on boot, only PULL — local edits stay local until you click Commit & Sync. The pending-count chip in the editor footer surfaces unsynced notes. Useful when this device often has work-in-flight you don't want auto-pushed."
      >
        <SettingsCheckbox
          checked={pullOnlyOnStartup}
          onChange={setPullOnlyOnStartup}
        />
      </Field>
      <Field
        label="Auto-sync every"
        description="Minutes between auto-syncs. 0 disables periodic syncing."
      >
        <div className="flex items-center gap-2">
          <SettingsTextInput
            value={String(autoSyncIntervalMinutes)}
            onCommit={(raw) => {
              const n = parseInt(raw, 10)
              const clamped = isNaN(n) || n < 0 ? 0 : Math.min(n, 1440)
              setAutoSyncIntervalMinutes(clamped)
            }}
            normalize={(raw) => {
              const n = parseInt(raw, 10)
              const clamped = isNaN(n) || n < 0 ? 0 : Math.min(n, 1440)
              return String(clamped)
            }}
            placeholder="0"
            mono
          />
          <span className="text-sm text-obsidianMuted">min</span>
        </div>
      </Field>
      <Field
        label="Settings folder"
        description="Repo path that holds settings.json. Different paths on different devices keep their settings independent. Empty disables settings sync."
      >
        <SettingsTextInput
          value={settingsFolderPath}
          onCommit={setSettingsFolderPath}
          normalize={(raw) => raw.trim().replace(/^\/+|\/+$/g, '')}
          placeholder=".noteser"
          mono
        />
      </Field>
      <VaultGitignoreField />
      <GitignoreOverlayField />
      <ResetToRemoteField />
    </div>
  )
}

// Destructive escape hatch: drop local copies of pushed notes and pull
// fresh from the repo. Useful when the user's local state drifted in a
// way they don't want to merge (e.g. corrupted edits, abandoned
// experiment, vault rebuilt elsewhere). Unpushed local notes are kept
// by default; an "also drop unpushed notes" checkbox forces a true
// clean slate.
function ResetToRemoteField() {
  const syncRepo = useGitHubStore(s => s.syncRepo)
  const { runSync } = useGitHubSync()
  const [confirming, setConfirming] = useState(false)
  const [dropUnpushed, setDropUnpushed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const confirmRef = useRef<HTMLDivElement | null>(null)

  // When the strip opens, scroll it into view. The Settings modal's
  // right pane is independently scrollable, so a long panel can clip
  // the strip's Cancel / Yes-reset buttons below the fold — caught by
  // qa-tester sweep on the deployed preview.
  useEffect(() => {
    if (confirming && confirmRef.current) {
      confirmRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [confirming])

  if (!syncRepo) return null

  const apply = async () => {
    setBusy(true)
    setResultMsg(null)
    try {
      const { resetToRemote } = await import('@/utils/resetToRemote')
      const r = resetToRemote({ preserveUnpushed: !dropUnpushed })
      // Kick the regular sync — it pulls and re-creates the wiped
      // notes from remote. Any further failures surface in the
      // standard sync status badge.
      await runSync()
      const kept = r.preserved > 0 ? ` · kept ${r.preserved} local-only` : ''
      setResultMsg(`Reset complete — dropped ${r.pushedDropped} pushed${kept}.`)
    } catch (err) {
      setResultMsg(`Reset failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setBusy(false)
      setConfirming(false)
      setDropUnpushed(false)
    }
  }

  return (
    <Field
      label="Reset to remote"
      description="Discard local edits to pushed notes and pull a fresh copy from the repo. Unpushed local notes are kept by default."
    >
      <div className="space-y-2">
        {!confirming ? (
          <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
            Reset local to match remote…
          </Button>
        ) : (
          <div ref={confirmRef} className="space-y-2 p-3 border border-amber-900/40 rounded bg-amber-900/10">
            <div className="text-sm text-amber-200">
              This drops every local note that has a synced path. The next pull will re-create them from the repo. There is no undo.
            </div>
            <label className="flex items-center gap-2 text-sm text-obsidianText">
              <input
                type="checkbox"
                checked={dropUnpushed}
                onChange={e => setDropUnpushed(e.target.checked)}
              />
              Also drop unpushed local notes (true clean slate)
            </label>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => { setConfirming(false); setDropUnpushed(false) }} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={apply} disabled={busy} data-testid="reset-to-remote-confirm">
                {busy ? 'Resetting…' : 'Yes, reset'}
              </Button>
            </div>
          </div>
        )}
        {resultMsg && <div className="text-xs text-obsidianSecondaryText">{resultMsg}</div>}
      </div>
    </Field>
  )
}

// In-app editor for the SHARED vault `.gitignore` (the file at the
// repo root). Lets the user fetch the current content on demand, edit
// it inline, and push on the next sync. The fetch button reads from
// GitHub directly so we don't have to wait for a full sync to see
// what's already there.
function VaultGitignoreField() {
  const token = useGitHubStore(s => s.token)
  const syncRepo = useGitHubStore(s => s.syncRepo)
  const draft = useSettingsStore(s => s.vaultGitignoreDraft)
  const snapshot = useSettingsStore(s => s.vaultGitignoreRemoteSnapshot)
  const setDraft = useSettingsStore(s => s.setVaultGitignoreDraft)
  const setSnapshot = useSettingsStore(s => s.setVaultGitignoreRemoteSnapshot)

  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const connected = !!(token && syncRepo)
  // Three UI states:
  //   - never fetched (draft + snapshot both null) → empty textarea + prompt
  //   - fetched + unchanged (draft === snapshot) → editor with no dirty marker
  //   - fetched + dirty (draft !== snapshot) → "Will push on next sync" badge
  const hasContent = draft != null || snapshot != null
  const dirty = draft != null && draft !== (snapshot ?? '')

  const handleFetch = async () => {
    if (!token || !syncRepo) return
    setFetching(true); setFetchError(null)
    try {
      const { fetchRemoteGitignore } = await import('@/utils/gitignoreSync')
      const { content } = await fetchRemoteGitignore(token, syncRepo)
      setSnapshot(content)
      setDraft(content)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Fetch failed')
    } finally {
      setFetching(false)
    }
  }

  const handleDiscard = () => {
    // Snap the textarea back to the last fetched remote content.
    // Clears the dirty marker without losing the snapshot.
    setDraft(snapshot)
  }

  return (
    <Field
      label="Vault .gitignore"
      description="The shared ignore file at the repo root. Fetch the current content, edit, and the next sync pushes your changes. Combined with the local overlay below for matching."
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleFetch}
            disabled={!connected || fetching}
            className="px-2 py-1 text-xs rounded border border-obsidianBorder bg-obsidianDarkGray text-obsidianText hover:border-obsidianAccentPurple disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="vault-gitignore-fetch"
          >
            {fetching ? 'Fetching…' : (hasContent ? 'Refetch from sync repo' : 'Fetch from sync repo')}
          </button>
          {dirty && (
            <span className="text-[11px] uppercase tracking-wide text-obsidianAccentPurple" data-testid="vault-gitignore-dirty">
              Will push on next sync
            </span>
          )}
          {dirty && (
            <button
              type="button"
              onClick={handleDiscard}
              className="text-xs text-obsidianSecondaryText hover:text-obsidianText underline"
              data-testid="vault-gitignore-discard"
            >
              Discard
            </button>
          )}
          {!connected && (
            <span className="text-xs text-obsidianSecondaryText">Connect a sync repo to enable.</span>
          )}
          {fetchError && (
            <span className="text-xs text-red-400" data-testid="vault-gitignore-error">{fetchError}</span>
          )}
        </div>
        <textarea
          value={draft ?? snapshot ?? ''}
          onChange={e => setDraft(e.target.value)}
          placeholder={hasContent ? '' : '# Click "Fetch from sync repo" to load the current .gitignore'}
          rows={6}
          spellCheck={false}
          disabled={!connected}
          className="w-full px-2 py-1.5 text-sm bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple font-mono resize-y disabled:opacity-50"
          data-testid="vault-gitignore-textarea"
        />
      </div>
    </Field>
  )
}

// Editable local .gitignore overlay. Per-DEVICE — combined with the
// remote vault `.gitignore` at sync time so the user can add personal
// ignores (e.g. scratch files) without touching the shared file.
// The shared file itself is edited via VaultGitignoreField above.
function GitignoreOverlayField() {
  const overlay = useSettingsStore(s => s.localGitignoreOverlay)
  const setOverlay = useSettingsStore(s => s.setLocalGitignoreOverlay)
  // Local draft so the textarea can render multi-line without the
  // SettingsTextInput's commit-on-blur dance — we save on every
  // keystroke via the store directly (cheap; it's a tiny string).
  return (
    <Field
      label="Local ignore patterns"
      description="Per-device additions to the vault's .gitignore — combined at sync time. One pattern per line. Useful for personal scratch files you don't want anyone else to see. Use a leading ! to un-ignore a remote rule."
    >
      <textarea
        value={overlay}
        onChange={e => setOverlay(e.target.value)}
        placeholder={'# extras only on this device\n*.scratch\n!important.scratch'}
        rows={5}
        spellCheck={false}
        className="w-full px-2 py-1.5 text-sm bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple font-mono resize-y"
        data-testid="local-gitignore-overlay"
      />
    </Field>
  )
}

function BetaPanel() {
  const betaEnabled = useSettingsStore(s => s.betaEnabled)
  const betaFlags = useSettingsStore(s => s.betaFlags)
  const setBetaEnabled = useSettingsStore(s => s.setBetaEnabled)
  const setBetaFlag = useSettingsStore(s => s.setBetaFlag)

  return (
    <div className="space-y-4" data-testid="settings-beta-panel">
      <PanelHeading>Beta features</PanelHeading>
      <p className="text-xs text-obsidianSecondaryText -mt-2">
        Opt into work-in-progress features. They may be buggy or removed.
        Bug reports for beta features are welcome via the About → Report a bug
        button.
      </p>
      <Field
        label="Enable beta features"
        description="Master switch. Individual flags below have no effect when this is off."
      >
        <SettingsCheckbox checked={betaEnabled} onChange={setBetaEnabled} />
      </Field>
      {betaEnabled && (
        <div className="space-y-3 pt-2 border-t border-obsidianBorder">
          {FLAGS.map(flag => (
            <Field
              key={flag.id}
              label={flag.label}
              description={flag.description}
            >
              <SettingsCheckbox
                checked={Boolean(betaFlags[flag.id])}
                onChange={(v) => setBetaFlag(flag.id, v)}
              />
            </Field>
          ))}
          {FLAGS.length === 0 && (
            <p className="text-sm text-obsidianSecondaryText italic">
              No experimental features available right now.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function AboutPanel() {
  // Version is best-effort: at dev time we don't have a real SHA, so this
  // is intentionally a placeholder. Build-time injection via
  // process.env.NEXT_PUBLIC_BUILD_SHA can replace it later.
  const version = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev'
  const openModal = useUIStore(s => s.openModal)
  return (
    <div className="space-y-4">
      <PanelHeading>About</PanelHeading>
      <div className="text-sm text-obsidianText space-y-2">
        <p>Noteser — browser-first, Obsidian-style markdown note-taking.</p>
        <p>
          <span className="text-obsidianSecondaryText">Version: </span>
          <span className="font-mono text-xs">{version}</span>
        </p>
        <p>
          <a
            href="https://github.com/ipapakonstantinou/noteser#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline"
            data-testid="settings-help-link"
          >
            Help &amp; docs →
          </a>
          <span className="text-obsidianSecondaryText"> (README on GitHub — covers GitHub sync, pinning panels, shortcuts, and getting started)</span>
        </p>
        <p>
          <a
            href="https://github.com/ipapakonstantinou/noteser"
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline"
          >
            github.com/ipapakonstantinou/noteser
          </a>
        </p>
        <p>
          <a
            href="https://noteser.thetechjon.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline"
          >
            noteser.thetechjon.com
          </a>
        </p>
        <p className="text-xs text-obsidianSecondaryText pt-2">
          MIT licence.
        </p>
      </div>
      <div className="pt-2">
        <button
          type="button"
          onClick={() => openModal({ type: 'bug-report' })}
          data-testid="settings-report-bug"
          className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors"
        >
          Report a bug
        </button>
      </div>
    </div>
  )
}

function PanelHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-base font-medium text-obsidianText border-b border-obsidianBorder pb-2 mb-3">
      {children}
    </h3>
  )
}

// Footer pinned to the bottom of the right pane. Memoised so changes to
// individual store fields don't churn it.
function SettingsFooterBar() {
  const closeModal = useUIStore(s => s.closeModal)
  const reset = useSettingsStore(s => s.reset)
  const footer = useMemo(() => (
    <div className="flex-none border-t border-obsidianBorder p-3">
      <SettingsFooter
        onReset={reset}
        onApply={() => {
          ;(document.activeElement as HTMLElement | null)?.blur?.()
          closeModal()
        }}
      />
    </div>
  ), [reset, closeModal])
  return footer
}

export default SettingsModal
