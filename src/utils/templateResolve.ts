// Daily / weekly note template resolution.
//
// THE BUG THIS FIXES (2026-06-19): the template reference used to be stored
// as the template note's id (dailyNoteTemplateId / weeklyNoteTemplateId).
// Note ids are NOT stable across a sync — `syncApply` mints a fresh uuid for
// every note that arrives as `remoteCreated` on pull. So a vault-synced
// settings.json carrying an id pointed at a note that, on any other clone,
// no longer existed under that id. The lookup returned nothing and new daily
// notes were created empty. Worse, it ping-ponged: re-picking the template on
// one device wrote that device's id, which then failed on the next.
//
// THE FIX: reference the template by its repo PATH (e.g. "Templates/Daily.md").
// A note's gitPath is the literal remote path and is preserved/adopted across
// clones, so the path is a stable cross-device identifier. notePath() derives
// the same path for a note that has not been pushed yet, so the two agree.

import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { notePath } from '@/utils/githubSync'
import type { Note, Folder } from '@/types'

// Stable, cross-sync identifier for a note: its repo path. Prefer the stored
// gitPath (the exact path the remote already holds — never rederived) and
// fall back to the derived path for a note that has never been pushed.
export function noteRepoPath(note: Note, folders: Folder[]): string {
  return note.gitPath || notePath(note, folders)
}

type TemplateKind = 'daily' | 'weekly'

// Resolve the configured template note for `kind`. Returns the matched note
// or undefined when no template is set / the template note is missing.
//
// Resolution order:
//   1. By stored repo path (the current, sync-safe representation).
//   2. Legacy fallback: an older settings file may still carry an id. Resolve
//      it once and lazily migrate to the path so the next sync can't break it.
export function resolveTemplateNote(kind: TemplateKind): Note | undefined {
  const settings = useSettingsStore.getState()
  const notes = useNoteStore.getState().notes
  const folders = useFolderStore.getState().folders

  const path = kind === 'daily' ? settings.dailyNoteTemplatePath : settings.weeklyNoteTemplatePath
  if (path) {
    return notes.find(n => !n.isDeleted && noteRepoPath(n, folders) === path)
  }

  const legacyId = kind === 'daily' ? settings.dailyNoteTemplateId : settings.weeklyNoteTemplateId
  if (legacyId) {
    const byId = notes.find(n => !n.isDeleted && n.id === legacyId)
    if (byId) {
      // Migrate: persist the stable path (and clear the id) so this device,
      // and the synced settings.json, stop depending on the volatile id.
      const migrated = noteRepoPath(byId, folders)
      if (kind === 'daily') settings.setDailyNoteTemplatePath(migrated)
      else settings.setWeeklyNoteTemplatePath(migrated)
      return byId
    }
  }
  return undefined
}

// Convenience: the template body to seed a new note with (or undefined).
export function resolveTemplateContent(kind: TemplateKind): string | undefined {
  return resolveTemplateNote(kind)?.content
}
