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

// Open or create a periodic note for the given date in the given
// folder. `templateContent` (when supplied) seeds the body on first
// creation — used by the weekly-note template setting.
function openPeriodicNote(
  now: Date,
  folderPath: string,
  format: string,
  templateContent?: string,
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

  const created = addNote({ title, folderId, content: templateContent ?? '' })
  useWorkspaceStore.getState().openNote(created.id, { preview: false })
  return created.id
}

// Resolve the configured weekly-note template's body (or undefined
// when no template is selected / the template note is missing). Kept
// private because the daily-note path uses the same dance inline.
function weeklyTemplateContent(): string | undefined {
  const settings = useSettingsStore.getState()
  const id = settings.weeklyNoteTemplateId
  if (!id) return undefined
  const note = useNoteStore.getState().notes.find(
    n => !n.isDeleted && n.id === id,
  )
  return note?.content
}

export function openThisWeekNote(now: Date = new Date()): string {
  const settings = useSettingsStore.getState()
  const folder = weeklyNotesFolder.get()
  const format = settings.weeklyNoteDateFormat || 'YYYY-WW'
  return openPeriodicNote(now, folder, format, weeklyTemplateContent())
}

// Open or create the weekly note for a specific week (identified by
// its Monday). Used by the sidebar Calendar's new W column — clicking
// "23" jumps to whichever YYYY-WW week the Monday of that row lives
// in. Same lookup/create dance as openThisWeekNote but with the date
// driven by the caller (not "now").
export function openWeekNote(weekStartDate: Date): string {
  const settings = useSettingsStore.getState()
  const folder = weeklyNotesFolder.get()
  const format = settings.weeklyNoteDateFormat || 'YYYY-WW'
  return openPeriodicNote(weekStartDate, folder, format, weeklyTemplateContent())
}

// Pure: look up the existing weekly note id (if any) for the given
// Monday. Returns the title (always computed) + the note id (or null
// when no note exists yet). Mirrors findDailyNoteId in CalendarView so
// the right-click menu can branch on "has note" without an open call.
export function findWeeklyNoteId(weekStartDate: Date): { id: string | null; title: string } {
  const settings = useSettingsStore.getState()
  const format = settings.weeklyNoteDateFormat || 'YYYY-WW'
  const title = formatDate(weekStartDate, format)
  const folder = weeklyNotesFolder.get()
  const segments = folder.split('/')
  // Find the folder WITHOUT creating it — purely a read. We mimic
  // ensureFolderPath's traversal but bail on the first missing segment.
  const folders = useFolderStore.getState().folders
  let parentId: string | null = null
  for (const seg of segments) {
    const found = folders.find(
      f => !f.isDeleted && f.parentId === parentId && f.name === seg,
    )
    if (!found) return { id: null, title }
    parentId = found.id
  }
  const folderId = parentId
  const note = useNoteStore.getState().notes.find(
    n => !n.isDeleted && n.folderId === folderId && n.title === title,
  )
  return { id: note?.id ?? null, title }
}

export function openThisMonthNote(now: Date = new Date()): string {
  const settings = useSettingsStore.getState()
  const folder = monthlyNotesFolder.get()
  const format = settings.monthlyNoteDateFormat || 'YYYY-MM'
  return openPeriodicNote(now, folder, format)
}
