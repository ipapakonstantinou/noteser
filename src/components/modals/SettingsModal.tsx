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
  PuzzlePieceIcon,
  SwatchIcon,
  ViewColumnsIcon,
  EyeIcon,
  FolderOpenIcon,
} from '@heroicons/react/24/outline'
import { PANELS } from '@/components/sidebar/sidebarPanelRegistry'
import { THEME_TOKENS, THEME_PRESETS } from '@/utils/theme'
import { FONT_SLOTS_DEF, SYSTEM_DEFAULT_VALUE, type FontSlot } from '@/utils/fonts'
import { useUIStore, useSettingsStore, useGitHubStore, useLocalFolderStore, useNoteStore, useFolderStore } from '@/stores'
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
import { EmailSignup } from '@/components/marketing/EmailSignup'
import { PluginsSettingsPanel } from './PluginsSettingsPanel'

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
  | 'local-folder'
  | 'ai'
  | 'shortcuts'
  | 'export'
  | 'plugins'
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
  { id: 'local-folder', label: 'Local folder', Icon: FolderOpenIcon },
  { id: 'ai',          label: 'AI',          Icon: SparklesIcon },
  { id: 'shortcuts',   label: 'Shortcuts',   Icon: CommandLineIcon },
  { id: 'export',      label: 'Export',      Icon: ArrowDownTrayIcon },
  { id: 'plugins',     label: 'Plugins',     Icon: PuzzlePieceIcon },
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
      <div className="flex flex-col md:flex-row h-[80dvh] md:h-[70dvh] min-h-[480px]">
        {/* ── Mobile (≤md): horizontal scroll strip of category chips
                across the top. Desktop: vertical left rail.
            Same buttons, different container; only the wrapper class
            changes by breakpoint. */}
        <nav
          aria-label="Settings categories"
          className="md:w-52 md:flex-none md:border-r border-b md:border-b-0 border-obsidianBorder bg-obsidianBlack/40 overflow-x-auto md:overflow-x-visible md:overflow-y-auto py-1 md:py-2 flex md:block flex-row gap-1 md:gap-0 px-2 md:px-0 flex-none"
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
                  // Mobile: rounded chip; desktop: full-width row.
                  'flex items-center gap-2 text-sm text-left transition-colors flex-none',
                  'px-3 py-1.5 rounded md:rounded-none md:w-full md:px-3 md:py-1.5',
                  isActive
                    ? 'bg-obsidianAccentPurple/15 text-obsidianText md:border-l-2 md:border-obsidianAccentPurple md:pl-[10px]'
                    : 'text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText md:border-l-2 md:border-transparent md:pl-[10px]',
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
            className="flex-1 min-h-0 overflow-y-auto p-4 md:p-5"
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
    case 'local-folder': return <LocalFolderPanel />
    case 'ai':          return <AISection />
    case 'shortcuts':   return <ShortcutsSection />
    case 'export':      return <ExportSection />
    case 'plugins':     return <PluginsSettingsPanel />
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
  const confirmBeforeTrash = useSettingsStore(s => s.confirmBeforeTrash)
  const shareDefaultExpiryDays = useSettingsStore(s => s.shareDefaultExpiryDays)
  const shareDefaultBurn = useSettingsStore(s => s.shareDefaultBurn)
  const startupNoteId = useSettingsStore(s => s.startupNoteId)
  const setFolderSortMode = useSettingsStore(s => s.setFolderSortMode)
  const setShowHiddenFolders = useSettingsStore(s => s.setShowHiddenFolders)
  const setTrashMode = useSettingsStore(s => s.setTrashMode)
  const setConfirmBulkDelete = useSettingsStore(s => s.setConfirmBulkDelete)
  const setConfirmBeforeTrash = useSettingsStore(s => s.setConfirmBeforeTrash)
  const setShareDefaultExpiryDays = useSettingsStore(s => s.setShareDefaultExpiryDays)
  const setShareDefaultBurn = useSettingsStore(s => s.setShareDefaultBurn)
  const setStartupNoteId = useSettingsStore(s => s.setStartupNoteId)

  // Note picker options: every non-deleted note labeled by FULL PATH
  // so two notes with the same title in different folders stay
  // distinguishable. Sorted by path, capped at 500 to keep the
  // dropdown usable on huge vaults.
  const notesForPicker = useNoteStore(s => s.notes)
  const foldersForPicker = useFolderStore(s => s.folders)
  const startupOptions = useMemo(() => {
    const folderById = new Map(foldersForPicker.map(f => [f.id, f] as const))
    const pathOf = (folderId: string | null): string => {
      const parts: string[] = []
      let cur: string | null = folderId
      while (cur) {
        const f = folderById.get(cur)
        if (!f) break
        parts.unshift(f.name)
        cur = f.parentId
      }
      return parts.join('/')
    }
    const labeled = notesForPicker
      .filter(n => !n.isDeleted)
      .map(n => {
        const folderPath = pathOf(n.folderId ?? null)
        const title = n.title || 'Untitled'
        const label = folderPath ? `${folderPath}/${title}` : title
        return { id: n.id, label }
      })
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
      .slice(0, 500)
    return [
      { value: '', label: 'Welcome view (default)' },
      ...labeled.map(n => ({ value: n.id, label: n.label })),
    ]
  }, [notesForPicker, foldersForPicker])

  return (
    <div className="space-y-4">
      <PanelHeading>General</PanelHeading>
      <Field
        label="Open on launch"
        description="Which note opens automatically when Noteser starts. Leave on `Welcome view` to keep the current behaviour."
      >
        <SettingsSelect<string>
          value={startupNoteId ?? ''}
          onChange={(v) => setStartupNoteId(v === '' ? null : v)}
          options={startupOptions}
        />
      </Field>
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
        label="Confirm before moving notes to trash"
        description="When off, deleting a note skips the confirmation and moves it straight to trash. Only applies in `Move to trash` mode — immediate-delete still confirms because it can't be undone."
      >
        <SettingsCheckbox
          checked={confirmBeforeTrash}
          onChange={setConfirmBeforeTrash}
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

      <FontsSection />
    </div>
  )
}

// Font pickers (fnt1). One row per slot: a curated dropdown plus a
// free-text Custom field for any locally-installed family. The dropdown
// shows "Custom…" whenever the stored value isn't one of the curated
// options, and reveals the text input so the user can type a family.
function FontsSection() {
  const fontText = useSettingsStore(s => s.fontText)
  const fontMono = useSettingsStore(s => s.fontMono)
  const fontInterface = useSettingsStore(s => s.fontInterface)
  const setFontText = useSettingsStore(s => s.setFontText)
  const setFontMono = useSettingsStore(s => s.setFontMono)
  const setFontInterface = useSettingsStore(s => s.setFontInterface)

  const values: Record<string, string> = {
    text: fontText,
    mono: fontMono,
    interface: fontInterface,
  }
  const setters: Record<string, (v: string) => void> = {
    text: setFontText,
    mono: setFontMono,
    interface: setFontInterface,
  }

  return (
    <div
      className="space-y-4 pt-3 mt-3 border-t border-obsidianBorder"
      data-testid="settings-fonts"
    >
      <div className="text-xs uppercase tracking-wide text-obsidianSecondaryText">
        Fonts
      </div>
      <p className="text-xs text-obsidianSecondaryText -mt-2">
        Choose a curated family or type the name of any font installed on
        this device. No fonts are downloaded. &ldquo;System default&rdquo;
        keeps today&apos;s look.
      </p>
      {FONT_SLOTS_DEF.map(slot => (
        <FontSlotRow
          key={slot.id}
          slot={slot}
          value={values[slot.id]}
          onChange={setters[slot.id]}
        />
      ))}
    </div>
  )
}

function FontSlotRow({
  slot,
  value,
  onChange,
}: {
  slot: FontSlot
  value: string
  onChange: (v: string) => void
}) {
  // Is the stored value one of the curated options? If not, the user is
  // in "Custom" mode and we surface the text field pre-filled with it.
  const isCurated = slot.options.some(o => o.value === value)
  const [custom, setCustom] = useState(isCurated ? '' : value)
  // Selecting "Custom…" flips this on without immediately writing a value
  // (an empty custom field would be treated as system default until typed).
  const [customMode, setCustomMode] = useState(!isCurated)
  const [draft, setDraft] = useState(custom)

  // Keep local state in sync if the store value changes underneath us
  // (e.g. a sync pull or Reset). Recompute curated-ness from the new value.
  useEffect(() => {
    const curated = slot.options.some(o => o.value === value)
    setCustomMode(!curated)
    if (!curated) {
      setCustom(value)
      setDraft(value)
    }
  }, [value, slot.options])

  const CUSTOM_SENTINEL = '__custom__'
  const selectValue = customMode ? CUSTOM_SENTINEL : value

  return (
    <Field label={slot.label} description={slot.description}>
      <div className="space-y-2">
        <SettingsSelect<string>
          value={selectValue}
          data-testid={`font-select-${slot.id}`}
          onChange={(v) => {
            if (v === CUSTOM_SENTINEL) {
              setCustomMode(true)
              // Don't write yet — wait for the user to type a family.
            } else {
              setCustomMode(false)
              onChange(v)
            }
          }}
          options={[
            ...slot.options,
            { value: CUSTOM_SENTINEL, label: 'Custom…' },
          ]}
        />
        {customMode && (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const v = draft.trim()
              setCustom(v)
              onChange(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            spellCheck={false}
            placeholder="e.g. JetBrains Mono"
            data-testid={`font-custom-${slot.id}`}
            className="block w-full bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-sm text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
          />
        )}
      </div>
    </Field>
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
  const taskQueryLenientDoneToday = useSettingsStore(s => s.taskQueryLenientDoneToday)
  const setTaskQueryLenientDoneToday = useSettingsStore(s => s.setTaskQueryLenientDoneToday)
  const notesOpenInPreviewMode = useSettingsStore(s => s.notesOpenInPreviewMode)
  const setNotesOpenInPreviewMode = useSettingsStore(s => s.setNotesOpenInPreviewMode)
  const editorAutocorrect = useSettingsStore(s => s.editorAutocorrect)
  const setEditorAutocorrect = useSettingsStore(s => s.setEditorAutocorrect)
  const reopenTabsOnStartup = useSettingsStore(s => s.reopenTabsOnStartup)
  const setReopenTabsOnStartup = useSettingsStore(s => s.setReopenTabsOnStartup)

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
        label="Autocorrect & word suggestions"
        description="When ON (default), lets your keyboard's autocorrect, auto-capitalisation, and predictive-text suggestions work while you type — most noticeable on phones, which only show their suggestion strip when this is on. Turn it OFF if you don't want it altering code blocks, wikilinks, or task syntax."
      >
        <SettingsCheckbox
          checked={editorAutocorrect}
          onChange={setEditorAutocorrect}
        />
      </Field>
      <Field
        label="Reopen tabs on startup"
        description="When ON (default), the notes you had open are reopened when you reload or return to noteser. Turn it OFF to start fresh with an empty workspace each time."
      >
        <SettingsCheckbox
          checked={reopenTabsOnStartup}
          onChange={setReopenTabsOnStartup}
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
      <Field
        label="Match completed tasks without a ✅ YYYY-MM-DD stamp as done today"
        description='When ON, "done today" also matches completed tasks without a completion date if their note was updated today. Leave OFF to require an explicit completion date.'
      >
        <SettingsCheckbox
          checked={taskQueryLenientDoneToday}
          onChange={setTaskQueryLenientDoneToday}
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

// Local folder sync (File System Access API — Chromium only). Pick a
// directory, then push the vault to it / import from it on demand. No
// auto-mirror for v1 — pushes happen via the buttons here so the user
// can keep the model in their head. The handle is persisted in IDB
// (see `localFolderSync.ts`); permission re-prompts once per session.
function LocalFolderPanel() {
  const status = useLocalFolderStore(s => s.status)
  const folderName = useLocalFolderStore(s => s.folderName)
  const lastSyncedAt = useLocalFolderStore(s => s.lastSyncedAt)
  const busy = useLocalFolderStore(s => s.busy)
  const lastError = useLocalFolderStore(s => s.lastError)
  const setStatus = useLocalFolderStore(s => s.setStatus)
  const setHandle = useLocalFolderStore(s => s.setHandle)
  const setBusy = useLocalFolderStore(s => s.setBusy)
  const recordSync = useLocalFolderStore(s => s.recordSync)
  const setLastError = useLocalFolderStore(s => s.setLastError)
  const openModal = useUIStore(s => s.openModal)

  // Boot: detect support + try to re-acquire a previously-saved handle.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { isLocalFolderSupported, loadLocalFolderHandle } = await import('@/utils/localFolderSync')
      if (cancelled) return
      if (!isLocalFolderSupported()) {
        setStatus('unsupported')
        return
      }
      const saved = await loadLocalFolderHandle()
      if (cancelled) return
      if (saved) {
        setHandle(saved, saved.name)
        setStatus('reconnecting')
      } else {
        setStatus('idle')
      }
    })()
    return () => { cancelled = true }
  }, [setStatus, setHandle])

  const handleConnect = async () => {
    setLastError(null)
    try {
      const { pickLocalFolder, saveLocalFolderHandle } = await import('@/utils/localFolderSync')
      const handle = await pickLocalFolder()
      await saveLocalFolderHandle(handle)
      setHandle(handle, handle.name)
      setStatus('connected')
    } catch (err) {
      // User-cancel raises AbortError; treat that as silent. Other
      // errors get surfaced.
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.toLowerCase().includes('abort')) {
        setLastError(msg)
      }
    }
  }

  const handleReconnect = async () => {
    setLastError(null)
    const { ensureFolderPermission } = await import('@/utils/localFolderSync')
    const handle = useLocalFolderStore.getState().handle
    if (!handle) return
    const granted = await ensureFolderPermission(handle)
    if (granted) {
      setStatus('connected')
    } else {
      setStatus('denied')
      setLastError('Permission denied. Click Reconnect to try again.')
    }
  }

  const handlePushToFolder = async () => {
    const handle = useLocalFolderStore.getState().handle
    if (!handle) return
    setBusy(true)
    setLastError(null)
    try {
      const { pushNotesToFolder, ensureFolderPermission } = await import('@/utils/localFolderSync')
      const granted = await ensureFolderPermission(handle)
      if (!granted) {
        setLastError('Permission denied.')
        setStatus('denied')
        return
      }
      await pushNotesToFolder(handle, useNoteStore.getState().notes)
      recordSync()
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setBusy(false)
    }
  }

  const handleImport = () => openModal({ type: 'local-folder-import' })

  const handleDisconnect = async () => {
    const { clearLocalFolderHandle } = await import('@/utils/localFolderSync')
    await clearLocalFolderHandle()
    setHandle(null, null)
    setStatus('idle')
  }

  return (
    <div className="space-y-4">
      <PanelHeading>Local folder sync</PanelHeading>

      <p className="text-sm text-obsidianSecondaryText">
        Mirror your vault to a folder on disk (Obsidian-style local vault). Edit notes in another
        editor and re-import; push the current vault out to a folder for backup. If the folder is
        a git repo, the In-folder git section below handles init / commit / push directly from
        noteser.
      </p>

      {status === 'unsupported' && (
        <div className="flex items-start gap-2 p-3 rounded bg-amber-900/20 border border-amber-900/40 text-amber-200 text-xs">
          <ExclamationTriangleIconUnsupported />
          <span>
            Your browser doesn&apos;t support the File System Access API. Use Chrome / Edge / Brave /
            Arc, or wait for the desktop build.
          </span>
        </div>
      )}

      {(status === 'idle' || status === 'denied') && (
        <button
          type="button"
          onClick={handleConnect}
          className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors"
          data-testid="local-folder-connect"
        >
          Connect a folder…
        </button>
      )}

      {status === 'reconnecting' && (
        <div className="space-y-2">
          <div className="text-xs text-obsidianSecondaryText">
            Previously connected to <span className="text-obsidianText font-mono">{folderName}</span>.
            Reconnect to grant permission again for this session.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReconnect}
              className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors"
              data-testid="local-folder-reconnect"
            >
              Reconnect
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianSecondaryText rounded hover:text-obsidianText hover:bg-obsidianHighlight transition-colors"
            >
              Forget folder
            </button>
          </div>
        </div>
      )}

      {status === 'connected' && (
        <div className="space-y-3" data-testid="local-folder-connected">
          <div className="text-xs text-obsidianSecondaryText">
            Connected: <span className="text-obsidianText font-mono">{folderName}</span>
            {lastSyncedAt && (
              <> &middot; last synced {new Date(lastSyncedAt).toLocaleTimeString()}</>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handlePushToFolder}
              disabled={busy}
              className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors disabled:opacity-50"
              data-testid="local-folder-push"
            >
              {busy ? 'Working…' : 'Push vault to folder'}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={busy}
              className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianText rounded hover:bg-obsidianHighlight transition-colors disabled:opacity-50"
              data-testid="local-folder-import-open"
            >
              Sync from folder…
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="px-3 py-1.5 text-sm border border-red-900/40 text-red-300 rounded hover:bg-red-900/20 transition-colors disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {lastError && (
        <div className="text-xs text-red-300 p-2 rounded border border-red-900/40 bg-red-900/20">
          {lastError}
        </div>
      )}

      {status === 'connected' && <InFolderGitSection />}
    </div>
  )
}

// In-folder git operations — only renders when the user has a connected
// local folder. Owns its own state machine: not-a-repo / no-remote /
// ready (repo + remote + token). Pure UI shell around the helpers in
// `src/utils/inBrowserGit.ts`.
function InFolderGitSection() {
  const handle = useLocalFolderStore(s => s.handle)
  const token = useGitHubStore(s => s.token)
  const user = useGitHubStore(s => s.user)
  const [isRepoNow, setIsRepoNow] = useState<boolean | null>(null)
  const [remote, setRemote] = useState<string | null>(null)
  const [remoteDraft, setRemoteDraft] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [busyStep, setBusyStep] = useState<null | 'init' | 'remote' | 'commit' | 'push'>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ modified: number; untracked: number; deleted: number } | null>(null)

  // Detect repo state + remote whenever the connected folder changes.
  useEffect(() => {
    if (!handle) return
    let cancelled = false
    setError(null)
    setIsRepoNow(null)
    setStatus(null)
    void (async () => {
      try {
        const { isRepo, getRemoteUrl, summarizeStatus } = await import('@/utils/inBrowserGit')
        const repo = await isRepo(handle)
        if (cancelled) return
        setIsRepoNow(repo)
        if (repo) {
          const url = await getRemoteUrl(handle)
          if (cancelled) return
          setRemote(url)
          setRemoteDraft(url ?? '')
          try {
            const s = await summarizeStatus(handle)
            if (!cancelled) {
              setStatus({
                modified: s.modified.length,
                untracked: s.untracked.length,
                deleted: s.deleted.length,
              })
            }
          } catch {
            // statusMatrix can fail on a fresh init with no commits;
            // that's fine — we just don't show the counts yet.
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Git inspect failed')
      }
    })()
    return () => { cancelled = true }
  }, [handle])

  if (!handle) return null

  const handleInit = async () => {
    setBusyStep('init')
    setError(null)
    try {
      const { initRepo } = await import('@/utils/inBrowserGit')
      await initRepo({ root: handle })
      setIsRepoNow(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Init failed')
    } finally {
      setBusyStep(null)
    }
  }

  const handleSetRemote = async () => {
    setBusyStep('remote')
    setError(null)
    try {
      const { setRemoteUrl } = await import('@/utils/inBrowserGit')
      await setRemoteUrl(handle, remoteDraft.trim())
      setRemote(remoteDraft.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Set remote failed')
    } finally {
      setBusyStep(null)
    }
  }

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    setBusyStep('commit')
    setError(null)
    try {
      const { stageAll, commit, summarizeStatus } = await import('@/utils/inBrowserGit')
      await stageAll({ root: handle })
      await commit({
        root: handle,
        message: commitMsg.trim(),
        author: {
          name: user?.name || user?.login || 'Noteser User',
          email: user?.login ? `${user.login}@users.noreply.github.com` : 'noteser@example.com',
        },
      })
      setCommitMsg('')
      const s = await summarizeStatus(handle)
      setStatus({ modified: s.modified.length, untracked: s.untracked.length, deleted: s.deleted.length })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed')
    } finally {
      setBusyStep(null)
    }
  }

  const handlePush = async () => {
    if (!token) {
      setError('Connect GitHub (Settings → GitHub sync) first — push needs your OAuth token.')
      return
    }
    setBusyStep('push')
    setError(null)
    try {
      const { push } = await import('@/utils/inBrowserGit')
      await push({ root: handle, token })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setBusyStep(null)
    }
  }

  const busy = busyStep != null

  return (
    <div className="space-y-3 mt-2 pt-4 border-t border-obsidianBorder" data-testid="in-folder-git">
      <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
        In-folder git
      </div>

      {isRepoNow === null && (
        <div className="text-xs text-obsidianSecondaryText italic">Inspecting folder…</div>
      )}

      {isRepoNow === false && (
        <div className="space-y-2">
          <p className="text-xs text-obsidianSecondaryText">
            Not a git repo yet. Initialise it to start tracking commits from inside noteser.
          </p>
          <button
            type="button"
            onClick={handleInit}
            disabled={busy}
            className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors disabled:opacity-50"
            data-testid="in-folder-git-init"
          >
            {busyStep === 'init' ? 'Initialising…' : 'Initialise git repo'}
          </button>
        </div>
      )}

      {isRepoNow === true && (
        <div className="space-y-3">
          <div className="text-xs text-obsidianSecondaryText">
            {status
              ? `Status: ${status.modified} modified · ${status.untracked} new · ${status.deleted} deleted`
              : 'No status yet (no commits in this repo).'}
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
              Remote (origin)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={remoteDraft}
                onChange={e => setRemoteDraft(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className="flex-1 px-2 py-1 text-xs font-mono bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple"
                data-testid="in-folder-git-remote-input"
              />
              <button
                type="button"
                onClick={handleSetRemote}
                disabled={busy || remoteDraft.trim() === (remote ?? '')}
                className="px-3 py-1 text-xs border border-obsidianBorder text-obsidianText rounded hover:bg-obsidianHighlight transition-colors disabled:opacity-50"
                data-testid="in-folder-git-set-remote"
              >
                {busyStep === 'remote' ? 'Setting…' : 'Set'}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] uppercase tracking-wide text-obsidianSecondaryText">
              Commit message
            </label>
            <textarea
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              placeholder="Describe what changed…"
              rows={2}
              className="w-full px-2 py-1 text-xs font-mono bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple resize-none"
              data-testid="in-folder-git-commit-message"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCommit}
              disabled={busy || !commitMsg.trim()}
              className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors disabled:opacity-50"
              data-testid="in-folder-git-commit"
            >
              {busyStep === 'commit' ? 'Committing…' : 'Commit'}
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={busy || !remote}
              className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianText rounded hover:bg-obsidianHighlight transition-colors disabled:opacity-50"
              title={remote ? '' : 'Set a remote first'}
              data-testid="in-folder-git-push"
            >
              {busyStep === 'push' ? 'Pushing…' : 'Push to origin'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-300 p-2 rounded border border-red-900/40 bg-red-900/20">
          {error}
        </div>
      )}
    </div>
  )
}

const ExclamationTriangleIconUnsupported = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 flex-shrink-0 mt-0.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
  </svg>
)

function GitHubPanel() {
  const autoSyncOnStart = useSettingsStore(s => s.autoSyncOnStart)
  const pullOnlyOnStartup = useSettingsStore(s => s.pullOnlyOnStartup)
  const autoSyncIntervalMinutes = useSettingsStore(s => s.autoSyncIntervalMinutes)
  const setAutoSyncOnStart = useSettingsStore(s => s.setAutoSyncOnStart)
  const setPullOnlyOnStartup = useSettingsStore(s => s.setPullOnlyOnStartup)
  const setAutoSyncIntervalMinutes = useSettingsStore(s => s.setAutoSyncIntervalMinutes)
  const defaultCommitMessage = useSettingsStore(s => s.defaultCommitMessage)
  const setDefaultCommitMessage = useSettingsStore(s => s.setDefaultCommitMessage)
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
        label="Default commit message"
        description='Pre-fills the Source Control commit textarea. Supports {{date}} which is substituted with today&apos;s YYYY-MM-DD at commit time. Vault-synced — any device sharing this repo gets the same template.'
      >
        <SettingsTextInput
          value={defaultCommitMessage}
          onCommit={setDefaultCommitMessage}
          placeholder="Sync from Noteser ({{date}})"
          mono
        />
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
      <VaultEncryptionField />
      <ResetToRemoteField />
    </div>
  )
}

// Vault encryption controls. Phase B of the backup-encryption feature.
// Surfaces three buttons depending on current state:
//   - Disabled:          [Enable encryption…]
//   - Enabled + locked:  [Unlock…] + [Disable encryption…]
//   - Enabled + unlocked: [Lock now] + [Disable encryption…]
//
// Subscribes to vaultKey's lock listener so the "locked vs unlocked"
// label flips live when sync unlocks the vault behind the scenes (or
// when a remote salt rotation invalidates the in-memory key).
function VaultEncryptionField() {
  const enabled = useSettingsStore(s => s.vaultEncryptionEnabled)
  const openModal = useUIStore(s => s.openModal)
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    // Dynamic import keeps the settings panel free of a hard
    // vault-key dep at module load (helps SSR + keeps the
    // Settings → General panel zero-cost).
    let cancelled = false
    let unsub: (() => void) | undefined
    void (async () => {
      const { isVaultUnlocked, onVaultLockChange } = await import('@/utils/vaultKey')
      if (cancelled) return
      setUnlocked(isVaultUnlocked())
      unsub = onVaultLockChange(() => setUnlocked(isVaultUnlocked()))
    })()
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  return (
    <Field
      label="Vault encryption"
      description="AES-GCM-encrypt note bodies before pushing to GitHub. Passphrase is never persisted — there is no recovery if you forget it."
    >
      {!enabled ? (
        <button
          type="button"
          onClick={() => openModal({ type: 'vault-encryption', data: { mode: 'enable', returnTo: 'settings' } })}
          className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors"
          data-testid="settings-encryption-enable"
        >
          Enable encryption…
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-obsidianSecondaryText" data-testid="settings-encryption-status">
            Status: {unlocked
              ? <span className="text-emerald-300">Enabled and unlocked</span>
              : <span className="text-amber-300">Enabled, vault is locked</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {unlocked ? (
              <button
                type="button"
                onClick={async () => {
                  const { lockVault } = await import('@/utils/vaultKey')
                  lockVault()
                }}
                className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianText rounded hover:bg-obsidianHighlight transition-colors"
                data-testid="settings-encryption-lock"
              >
                Lock now
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openModal({ type: 'vault-encryption', data: { mode: 'unlock', returnTo: 'settings' } })}
                className="px-3 py-1.5 text-sm bg-obsidianAccentPurple/15 text-obsidianAccentPurple border border-obsidianAccentPurple/40 rounded hover:bg-obsidianAccentPurple/25 transition-colors"
                data-testid="settings-encryption-unlock"
              >
                Unlock…
              </button>
            )}
            {/* Change-passphrase entry. Only meaningful once the vault is
                unlocked: the modal verifies the OLD passphrase before
                deriving the new key, so we never end up with a salt
                rotation the user can't undo. */}
            {unlocked && (
              <button
                type="button"
                onClick={() => openModal({ type: 'vault-encryption', data: { mode: 'change', returnTo: 'settings' } })}
                className="px-3 py-1.5 text-sm border border-obsidianBorder text-obsidianText rounded hover:bg-obsidianHighlight transition-colors"
                data-testid="settings-encryption-change"
              >
                Change passphrase…
              </button>
            )}
            <button
              type="button"
              onClick={() => openModal({ type: 'vault-encryption', data: { mode: 'confirm-disable', returnTo: 'settings' } })}
              className="px-3 py-1.5 text-sm border border-red-900/40 text-red-300 rounded hover:bg-red-900/20 transition-colors"
              data-testid="settings-encryption-disable"
            >
              Disable encryption…
            </button>
          </div>
        </div>
      )}
    </Field>
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
  // Reset-to-remote PULLS the remote version; it must never push (pushing
  // here re-sent settings.json + attachments as a surprise commit).
  const { runPullOnly } = useGitHubSync()
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
      const r = await resetToRemote({ preserveUnpushed: !dropUnpushed })
      // Pull-only — re-create the wiped notes from remote without pushing
      // anything back (reset means "match the remote", not "send local").
      await runPullOnly()
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
  // Semver from package.json, paired with the short build id Vercel
  // injects per deploy (commit SHA in prod, ms timestamp on local
  // builds — see next.config.mjs). Local dev has no SHA so the
  // build id falls back to the millisecond stamp.
  const semver = process.env.NEXT_PUBLIC_NOTESER_VERSION ?? 'dev'
  const buildIdRaw = process.env.NEXT_PUBLIC_BUILD_ID ?? ''
  const buildId = buildIdRaw && buildIdRaw.length > 7 ? buildIdRaw.slice(0, 7) : buildIdRaw
  const version = buildId ? `${semver} (${buildId})` : semver
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
            href="/help"
            target="_blank"
            rel="noopener noreferrer"
            className="text-obsidianAccentPurple hover:underline"
            data-testid="settings-help-link"
          >
            Help &amp; docs →
          </a>
          <span className="text-obsidianSecondaryText"> (in-app help — getting started, GitHub sync, local folder, shortcuts, FAQ)</span>
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
            href="https://github.com/ipapakonstantinou/noteser/issues/new"
            target="_blank"
            rel="noreferrer"
            className="text-obsidianAccentPurple hover:underline"
            data-testid="settings-report-issue-link"
          >
            Report an issue on GitHub →
          </a>
          <span className="text-obsidianSecondaryText"> (opens a new GitHub issue in a new tab)</span>
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
      <div className="pt-4 border-t border-obsidianBorder">
        <div className="text-sm text-obsidianText mb-2">Get launch updates</div>
        <p className="text-xs text-obsidianSecondaryText mb-3">
          A short email when sync, mobile, and the next features land. No spam.
        </p>
        <EmailSignup source="settings-about" compact />
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
