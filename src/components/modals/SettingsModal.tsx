'use client'

import { useUIStore, useSettingsStore } from '@/stores'
import type { FolderSortMode, TaskListDensity } from '@/stores'
import { Modal } from '@/components/ui'
import { AttachmentsSection } from './AttachmentsSection'

export const SettingsModal = () => {
  const { modal, closeModal } = useUIStore()
  const folderSortMode = useSettingsStore(s => s.folderSortMode)
  const taskListDensity = useSettingsStore(s => s.taskListDensity)
  const showHiddenFolders = useSettingsStore(s => s.showHiddenFolders)
  const setFolderSortMode = useSettingsStore(s => s.setFolderSortMode)
  const setTaskListDensity = useSettingsStore(s => s.setTaskListDensity)
  const setShowHiddenFolders = useSettingsStore(s => s.setShowHiddenFolders)
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
            <select
              value={folderSortMode}
              onChange={(e) => setFolderSortMode(e.target.value as FolderSortMode)}
              className="bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-sm text-obsidianText focus:outline-none focus:border-obsidianAccentPurple"
            >
              <option value="alphabetical">Alphabetical (A → Z)</option>
              <option value="modified">Last modified (newest first)</option>
              <option value="created">Date created (newest first)</option>
              <option value="manual">Manual (insertion order)</option>
            </select>
          </Field>
          <Field
            label="Show hidden folders"
            description="Folders flagged as hidden (currently: attachments/). Turn off to suppress them from the sidebar."
          >
            <input
              type="checkbox"
              checked={showHiddenFolders}
              onChange={(e) => setShowHiddenFolders(e.target.checked)}
              className="h-4 w-4 accent-obsidianAccentPurple cursor-pointer"
            />
          </Field>
        </Section>

        <Section title="Tasks">
          <Field
            label="Task list density"
            description='Spacing inside `tasks` query blocks. "Comfortable" matches Obsidian; "Compact" is the legacy noteser default.'
          >
            <select
              value={taskListDensity}
              onChange={(e) => setTaskListDensity(e.target.value as TaskListDensity)}
              className="bg-obsidianDarkGray border border-obsidianBorder rounded px-2 py-1 text-sm text-obsidianText focus:outline-none focus:border-obsidianAccentPurple"
            >
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
            </select>
          </Field>
        </Section>

        <Section title="Attachments">
          <AttachmentsSection />
        </Section>

        <div className="pt-4 border-t border-obsidianBorder flex justify-end">
          <button
            onClick={() => {
              if (confirm('Reset all settings to defaults?')) reset()
            }}
            className="text-xs text-obsidianSecondaryText hover:text-obsidianText"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </Modal>
  )
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <h4 className="text-sm font-medium text-obsidianSecondaryText uppercase tracking-wide mb-3">
      {title}
    </h4>
    <div className="space-y-3">{children}</div>
  </div>
)

const Field = ({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}) => (
  <div className="flex items-start justify-between gap-4">
    <div className="flex-1 min-w-0">
      <div className="text-obsidianText text-sm">{label}</div>
      <div className="text-obsidianSecondaryText text-xs mt-0.5">{description}</div>
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
)

export default SettingsModal
