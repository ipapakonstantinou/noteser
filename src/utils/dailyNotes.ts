// Opens (or creates) today's daily note. Used by the Alt+D keyboard
// shortcut, the calendar view's "Today" button, and Settings preview.
//
// Lookup order:
//   1. If a note with the formatted-date title already exists inside the
//      configured daily-notes folder, open it.
//   2. Otherwise create a new note in that folder. Seed its content
//      from the configured daily-note template if one is set and still
//      exists; fall back to empty content.
//
// We don't touch the GitHub sync path — the note becomes a regular Note
// entity and will sync on the next push like any other.

import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { dailyNotesFolder } from './systemFolder'
import { formatDate } from './dateFormat'
import { noteRepoPath, resolveTemplateContent } from './templateResolve'

// Opens today's daily note, creating it (with the configured template)
// if it doesn't exist yet. Returns the resolved note id.
export function openTodayNote(now: Date = new Date()): string {
  const settings = useSettingsStore.getState()
  const format = settings.dailyNoteDateFormat || 'YYYY-MM-DD'
  const title = formatDate(now, format)

  const folderSegments = dailyNotesFolder.get().split('/')
  const folderId = useFolderStore.getState().ensureFolderPath(folderSegments)

  const { notes, addNote } = useNoteStore.getState()
  const existing = notes.find(n => !n.isDeleted && n.folderId === folderId && n.title === title)
  if (existing) {
    useWorkspaceStore.getState().openNote(existing.id, { preview: false })
    return existing.id
  }

  // Look up the configured template (if any) and copy its content. Resolved
  // by stable repo path, not the volatile note id — see templateResolve.ts.
  const content = resolveTemplateContent('daily') ?? ''

  const created = addNote({ title, folderId, content })
  useWorkspaceStore.getState().openNote(created.id, { preview: false })
  return created.id
}

// Helper for the Settings dropdown: list every active note inside the
// configured templates folder (and its subfolders) so the user can pick
// one. Returns { id, title, repoPath } for display.
export function listTemplateNotes(): Array<{ id: string; title: string; repoPath: string; path: string }> {
  const { notes } = useNoteStore.getState()
  const { folders } = useFolderStore.getState()
  const settings = useSettingsStore.getState()
  const templatesRoot = (settings.templatesFolder || 'Templates').trim()
  if (!templatesRoot) return []

  // Compute repo paths for every folder so we can match anything under
  // the templates root (including nested subfolders).
  const byId = new Map(folders.map(f => [f.id, f]))
  function pathFor(folderId: string | null): string {
    if (!folderId) return ''
    const segs: string[] = []
    let cur = byId.get(folderId)
    for (let i = 0; cur && i < 32; i++) {
      if (cur.isDeleted) break
      segs.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return segs.join('/')
  }

  const out: Array<{ id: string; title: string; repoPath: string; path: string }> = []
  for (const n of notes) {
    if (n.isDeleted) continue
    const folderPath = pathFor(n.folderId)
    if (folderPath !== templatesRoot && !folderPath.startsWith(`${templatesRoot}/`)) continue
    // `path` is the stable per-note identifier the template setting stores;
    // `repoPath` (folder only) is retained for the dropdown's display label.
    out.push({ id: n.id, title: n.title, repoPath: folderPath, path: noteRepoPath(n, folders) })
  }
  out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  return out
}
