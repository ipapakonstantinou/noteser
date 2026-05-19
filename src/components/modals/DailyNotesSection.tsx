'use client'

import { useMemo } from 'react'
import { useNoteStore, useSettingsStore } from '@/stores'
import { listTemplateNotes } from '@/utils/dailyNotes'
import {
  Field,
  SettingsSelect,
  SettingsTextInput,
} from './settings'

// Trim whitespace + edge slashes + collapse repeats. Mirrors the
// attachments-folder policy without inheriting its specific default.
const normalizeFolder = (s: string | undefined | null): string => {
  if (!s) return ''
  return s.trim().replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/')
}

export const DailyNotesSection = () => {
  const dailyFolder = useSettingsStore(s => s.dailyNotesFolder)
  const dateFormat = useSettingsStore(s => s.dailyNoteDateFormat)
  const setDailyFolder = useSettingsStore(s => s.setDailyNotesFolder)
  const setDateFormat = useSettingsStore(s => s.setDailyNoteDateFormat)

  return (
    <>
      <Field
        label="Folder"
        description="Where new daily notes are created. Defaults to `Daily Notes`."
      >
        <SettingsTextInput
          value={dailyFolder}
          onCommit={(v) => setDailyFolder(normalizeFolder(v) || 'Daily Notes')}
          placeholder="Daily Notes"
          mono
        />
      </Field>
      <Field
        label="Date format"
        description="Title format. Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd. Example: `YYYY-MM-DD` → 2026-05-19."
      >
        <SettingsTextInput
          value={dateFormat}
          onCommit={(v) => setDateFormat(v.trim() || 'YYYY-MM-DD')}
          placeholder="YYYY-MM-DD"
          mono
        />
      </Field>
    </>
  )
}

export const TemplatesSection = () => {
  const notes = useNoteStore(s => s.notes)
  const templatesFolder = useSettingsStore(s => s.templatesFolder)
  const dailyTemplateId = useSettingsStore(s => s.dailyNoteTemplateId)
  const setTemplatesFolder = useSettingsStore(s => s.setTemplatesFolder)
  const setDailyTemplateId = useSettingsStore(s => s.setDailyNoteTemplateId)

  // Re-run when notes change so the dropdown reflects fresh template
  // files. listTemplateNotes reads the live settings + stores.
  const templateNotes = useMemo(() => listTemplateNotes(), [notes, templatesFolder])

  const NONE = '' // sentinel for "no template selected"
  const options = useMemo(
    () => [
      { value: NONE, label: '— No template —' },
      ...templateNotes.map((n) => ({
        value: n.id,
        label: n.repoPath ? `${n.title} (${n.repoPath})` : n.title,
      })),
    ],
    [templateNotes],
  )

  return (
    <>
      <Field
        label="Folder"
        description="Where template notes live. Notes inside this folder appear in the picker below."
      >
        <SettingsTextInput
          value={templatesFolder}
          onCommit={(v) => setTemplatesFolder(normalizeFolder(v) || 'Templates')}
          placeholder="Templates"
          mono
        />
      </Field>
      <Field
        label="Daily note template"
        description="When a daily note is created (Alt+D / calendar click), its content is seeded from this note."
      >
        <SettingsSelect<string>
          value={dailyTemplateId ?? NONE}
          onChange={(v) => setDailyTemplateId(v === NONE ? null : v)}
          options={options}
        />
      </Field>
    </>
  )
}
