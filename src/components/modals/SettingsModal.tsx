'use client'

import { useUIStore, useSettingsStore } from '@/stores'
import type { FolderSortMode, TaskListDensity, AutoSyncInterval } from '@/stores'
import { Modal } from '@/components/ui'
import { AttachmentsSection } from './AttachmentsSection'
import { DailyNotesSection, TemplatesSection } from './DailyNotesSection'
import {
  Section,
  Field,
  SettingsSelect,
  SettingsCheckbox,
  SettingsFooter,
} from './settings'

export const SettingsModal = () => {
  const { modal, closeModal } = useUIStore()
  const folderSortMode = useSettingsStore(s => s.folderSortMode)
  const taskListDensity = useSettingsStore(s => s.taskListDensity)
  const showHiddenFolders = useSettingsStore(s => s.showHiddenFolders)
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
            description="Repeat the sync on this cadence. Off disables periodic syncing — you can still sync manually from the sidebar."
          >
            <SettingsSelect<AutoSyncInterval>
              value={autoSyncIntervalMinutes}
              onChange={setAutoSyncIntervalMinutes}
              options={[
                { value: 0, label: 'Off' },
                { value: 5, label: '5 minutes' },
                { value: 15, label: '15 minutes' },
                { value: 30, label: '30 minutes' },
                { value: 60, label: '1 hour' },
              ]}
            />
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
