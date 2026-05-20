// Weekly + monthly notes. Mirrors `dailyNotes.ts` but bucketed by ISO
// week / calendar month. A note is identified by its title (the formatted
// period) inside the configured folder.
//
// Lookup order is identical to dailyNotes:
//   1. If a note with the formatted-period title already exists in the
//      configured folder, open it.
//   2. Otherwise create a new note in that folder. Future enhancement: a
//      per-period template (parallel to dailyNoteTemplateId).
//
// Command palette + future ribbon buttons call into these.

import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { weeklyNotesFolder, monthlyNotesFolder } from './systemFolder'
import { formatDate } from './dateFormat'

function openPeriodicNote(
  now: Date,
  folderPath: string,
  format: string,
): string {
  const title = formatDate(now, format)
  const segments = folderPath.split('/')
  const folderId = useFolderStore.getState().ensureFolderPath(segments)

  const { notes, addNote } = useNoteStore.getState()
  const existing = notes.find(
    n => !n.isDeleted && n.folderId === folderId && n.title === title,
  )
  if (existing) {
    useWorkspaceStore.getState().openNote(existing.id, { preview: false })
    return existing.id
  }

  const created = addNote({ title, folderId, content: '' })
  useWorkspaceStore.getState().openNote(created.id, { preview: false })
  return created.id
}

export function openThisWeekNote(now: Date = new Date()): string {
  const settings = useSettingsStore.getState()
  const folder = weeklyNotesFolder.get()
  const format = settings.weeklyNoteDateFormat || 'YYYY-WW'
  return openPeriodicNote(now, folder, format)
}

export function openThisMonthNote(now: Date = new Date()): string {
  const settings = useSettingsStore.getState()
  const folder = monthlyNotesFolder.get()
  const format = settings.monthlyNoteDateFormat || 'YYYY-MM'
  return openPeriodicNote(now, folder, format)
}
