'use client'

import { useMemo } from 'react'
import { useNoteStore, useSettingsStore } from '@/stores'
import type { CalendarWeekStartDay } from '@/stores/settingsStore'
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
  const weekStartDay = useSettingsStore(s => s.calendarWeekStartDay)
  const setDailyFolder = useSettingsStore(s => s.setDailyNotesFolder)
  const setDateFormat = useSettingsStore(s => s.setDailyNoteDateFormat)
  const setWeekStartDay = useSettingsStore(s => s.setCalendarWeekStartDay)

  // Weekly notes (2026-06-04 — companion to the new calendar W
  // column). Folder + title format mirror the daily fields; the
  // weekly-note template is set in the Templates section below
  // (keeps all template pickers together).
  const weeklyFolder = useSettingsStore(s => s.weeklyNotesFolder)
  const weeklyFormat = useSettingsStore(s => s.weeklyNoteDateFormat)
  const setWeeklyFolder = useSettingsStore(s => s.setWeeklyNotesFolder)
  const setWeeklyFormat = useSettingsStore(s => s.setWeeklyNoteDateFormat)

  return (
    <>
      <h3 className="text-sm font-medium text-obsidianText mb-2">Daily notes</h3>
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
      <Field
        label="Calendar starts on"
        description="First day of the week in the sidebar Calendar grid. This is a per-device display preference and is not synced."
      >
        <SettingsSelect<CalendarWeekStartDay>
          value={weekStartDay}
          onChange={setWeekStartDay}
          options={[
            { value: 0, label: 'Sunday' },
            { value: 1, label: 'Monday' },
          ]}
        />
      </Field>

      <h3 className="text-sm font-medium text-obsidianText mt-6 mb-2">Weekly notes</h3>
      <Field
        label="Folder"
        description="Where new weekly notes are created. Defaults to `Notes/Weekly`."
      >
        <SettingsTextInput
          value={weeklyFolder}
          onCommit={(v) => setWeeklyFolder(normalizeFolder(v) || 'Notes/Weekly')}
          placeholder="Notes/Weekly"
          mono
        />
      </Field>
      <Field
        label="Title format"
        description="Title format for weekly notes. Tokens include `WW` / `W` (ISO week number). Example: `YYYY-[W]WW` → 2026-W23."
      >
        <SettingsTextInput
          value={weeklyFormat}
          onCommit={(v) => setWeeklyFormat(v.trim() || 'YYYY-[W]WW')}
          placeholder="YYYY-[W]WW"
          mono
        />
      </Field>
    </>
  )
}

export const TemplatesSection = () => {
  const notes = useNoteStore(s => s.notes)
  const templatesFolder = useSettingsStore(s => s.templatesFolder)
  // Subscribe to both the path and the deprecated id so the picker re-renders
  // (and recomputes the active selection) when either changes.
  const dailyTemplatePath = useSettingsStore(s => s.dailyNoteTemplatePath)
  const weeklyTemplatePath = useSettingsStore(s => s.weeklyNoteTemplatePath)
  const dailyTemplateIdLegacy = useSettingsStore(s => s.dailyNoteTemplateId)
  const weeklyTemplateIdLegacy = useSettingsStore(s => s.weeklyNoteTemplateId)
  const setTemplatesFolder = useSettingsStore(s => s.setTemplatesFolder)
  const setDailyTemplatePath = useSettingsStore(s => s.setDailyNoteTemplatePath)
  const setWeeklyTemplatePath = useSettingsStore(s => s.setWeeklyNoteTemplatePath)

  // Re-run when notes change so the dropdown reflects fresh template
  // files. listTemplateNotes reads from useNoteStore.getState() +
  // useSettingsStore.getState() internally, so the values aren't used
  // directly — they're triggers for recomputation. ESLint can't see
  // through that, hence the disable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const templateNotes = useMemo(() => listTemplateNotes(), [notes, templatesFolder])

  const NONE = '' // sentinel for "no template selected"
  // Options are keyed by the note's stable repo path (not its id), matching
  // what the setting stores. See templateResolve.ts for why.
  const options = useMemo(
    () => [
      { value: NONE, label: '— No template —' },
      ...templateNotes.map((n) => ({
        value: n.path,
        label: n.repoPath ? `${n.title} (${n.repoPath})` : n.title,
      })),
    ],
    [templateNotes],
  )

  // Resolve the active selection to a path, transparently mapping a legacy
  // id-based value (pre-migration) to its path so the dropdown reflects it.
  // Recomputes on each render off the subscribed settings + templateNotes.
  const resolveValue = (path: string | null, legacyId: string | null): string => {
    if (path) return path
    if (legacyId) return templateNotes.find(t => t.id === legacyId)?.path ?? NONE
    return NONE
  }
  const dailyValue = resolveValue(dailyTemplatePath, dailyTemplateIdLegacy)
  const weeklyValue = resolveValue(weeklyTemplatePath, weeklyTemplateIdLegacy)

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
          value={dailyValue}
          onChange={(v) => setDailyTemplatePath(v === NONE ? null : v)}
          options={options}
        />
      </Field>
      <Field
        label="Weekly note template"
        description="When a weekly note is created (calendar W-column click), its content is seeded from this note."
      >
        <SettingsSelect<string>
          value={weeklyValue}
          onChange={(v) => setWeeklyTemplatePath(v === NONE ? null : v)}
          options={options}
        />
      </Field>
    </>
  )
}
