'use client'

import { useUIStore, useSettingsStore } from '@/stores'
import type { FolderSortMode, TaskListDensity } from '@/stores'
import type { TrashMode } from '@/stores/settingsStore'
import { Modal } from '@/components/ui'
import { AttachmentsSection } from './AttachmentsSection'
import { AISection } from './AISection'
import { DailyNotesSection, TemplatesSection } from './DailyNotesSection'
import { ExportSection } from './ExportSection'
import { ShortcutsSection } from './ShortcutsSection'
import {
  Section,
  Field,
  SettingsSelect,
  SettingsCheckbox,
  SettingsTextInput,
  SettingsFooter,
} from './settings'

export const SettingsModal = () => {
  const { modal, closeModal } = useUIStore()
  const folderSortMode = useSettingsStore(s => s.folderSortMode)
  const taskListDensity = useSettingsStore(s => s.taskListDensity)
  const showHiddenFolders = useSettingsStore(s => s.showHiddenFolders)
  const trashMode = useSettingsStore(s => s.trashMode)
  const setTrashMode = useSettingsStore(s => s.setTrashMode)
  const autoSyncOnStart = useSettingsStore(s => s.autoSyncOnStart)
  const autoSyncIntervalMinutes = useSettingsStore(s => s.autoSyncIntervalMinutes)
  const setFolderSortMode = useSettingsStore(s => s.setFolderSortMode)
  const setTaskListDensity = useSettingsStore(s => s.setTaskListDensity)
  const setShowHiddenFolders = useSettingsStore(s => s.setShowHiddenFolders)
  const setAutoSyncOnStart = useSettingsStore(s => s.setAutoSyncOnStart)
  const setAutoSyncIntervalMinutes = useSettingsStore(s => s.setAutoSyncIntervalMinutes)
  const reset = useSettingsStore(s => s.reset)

  const isOpen = modal.type === 'settings'

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title="Settings" size="lg">
      <div className="space-y-6">
        <Section title="Files & Folders">
          <Field
            label="Sort notes within folders"
            description="How notes are ordered in the sidebar. Manual = insertion order (current behavior)."
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
        </Section>

        <Section title="Tasks">
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
        </Section>

        <Section title="Attachments">
          <AttachmentsSection />
        </Section>

        <Section title="Daily notes">
          <DailyNotesSection />
        </Section>

        <Section title="Templates">
          <TemplatesSection />
        </Section>

        <Section title="AI">
          <AISection />
        </Section>

        <Section title="Keyboard shortcuts">
          <ShortcutsSection />
        </Section>

        <Section title="Export">
          <ExportSection />
        </Section>

        <Section title="GitHub sync">
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
        </Section>

        <SettingsFooter
          onReset={reset}
          onApply={() => {
            // Commit any pending draft inputs (e.g. the attachments folder
            // field) by blurring whatever input is focused, then close.
            ;(document.activeElement as HTMLElement | null)?.blur?.()
            closeModal()
          }}
        />
      </div>
    </Modal>
  )
}

export default SettingsModal
