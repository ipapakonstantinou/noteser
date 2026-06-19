'use client'

import { useSettingsStore } from '@/stores'
import type { TaskListDensity, CollaborationMode } from '@/stores'
import { getConfiguredUrl } from '@/hooks/useCollaboration'
import {
  Field,
  SettingsSelect,
  SettingsCheckbox,
} from '../index'
import { PanelHeading } from '../PanelHeading'

export function EditorPanel() {
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
  const collaborationMode = useSettingsStore(s => s.collaborationMode)
  const setCollaborationMode = useSettingsStore(s => s.setCollaborationMode)
  // The transport (NEXT_PUBLIC_YJS_WS_URL) must be configured for any non-off
  // mode to actually connect. When it isn't, we still show the control so the
  // setting is discoverable, but add a note that no server is configured.
  const collabTransportConfigured = getConfiguredUrl() != null

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
        label="Collaboration"
        description={
          collabTransportConfigured
            ? 'Real-time editing over a shared connection. Off (default) keeps every note solo and fast. Per-note connects only for notes you switch to Live (status bar) or open from a share link — others stay solo. Whole repo makes every note live.'
            : 'Real-time editing over a shared connection. No collaboration server is configured on this deployment, so the connection stays dormant whatever you pick here. Off (default) keeps every note solo and fast.'
        }
      >
        <SettingsSelect<CollaborationMode>
          value={collaborationMode}
          onChange={setCollaborationMode}
          data-testid="settings-collaboration-mode"
          options={[
            { value: 'off', label: 'Off' },
            { value: 'per-note', label: 'Per-note' },
            { value: 'repo', label: 'Whole repo' },
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
