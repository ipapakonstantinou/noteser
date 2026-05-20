'use client'

import { useState, useMemo, type ReactNode } from 'react'
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
} from '@heroicons/react/24/outline'
import { useUIStore, useSettingsStore } from '@/stores'
import type { FolderSortMode, TaskListDensity } from '@/stores'
import type { TrashMode } from '@/stores/settingsStore'
import { Modal } from '@/components/ui'
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
  | 'editor'
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
  { id: 'editor',      label: 'Editor',      Icon: PencilSquareIcon },
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
      <div className="flex flex-row h-[70vh] min-h-[480px]">
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
    case 'editor':      return <EditorPanel />
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
  const setFolderSortMode = useSettingsStore(s => s.setFolderSortMode)
  const setShowHiddenFolders = useSettingsStore(s => s.setShowHiddenFolders)
  const setTrashMode = useSettingsStore(s => s.setTrashMode)

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
    </div>
  )
}

function EditorPanel() {
  const taskListDensity = useSettingsStore(s => s.taskListDensity)
  const setTaskListDensity = useSettingsStore(s => s.setTaskListDensity)

  return (
    <div className="space-y-4">
      <PanelHeading>Editor</PanelHeading>
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

function GitHubPanel() {
  const autoSyncOnStart = useSettingsStore(s => s.autoSyncOnStart)
  const autoSyncIntervalMinutes = useSettingsStore(s => s.autoSyncIntervalMinutes)
  const setAutoSyncOnStart = useSettingsStore(s => s.setAutoSyncOnStart)
  const setAutoSyncIntervalMinutes = useSettingsStore(s => s.setAutoSyncIntervalMinutes)

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
    </div>
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
