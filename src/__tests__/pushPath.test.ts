/**
 * pushPath.test.ts
 *
 * preserve-gitpath-on-push (the sanitizer-churn fix): the path a PUSH writes a
 * note to.
 *
 *   - A NEW note (no gitPath) derives a fresh path from its title via the
 *     relaxed sanitizer.
 *   - A SYNCED note (has gitPath) whose title + folder still derive to that
 *     gitPath uses the stored gitPath VERBATIM — this is the no-churn path for
 *     a freshly-cloned vault, including names with `&` / `'` that the OLD
 *     sanitizer would have stripped.
 *   - A SYNCED note that was genuinely renamed/moved (derived path differs from
 *     gitPath) derives the new path so the move propagates to the remote; the
 *     push's deletion loop removes the old gitPath.
 */

import { pushPath, notePath } from '../utils/githubSync'
import type { Note, Folder } from '@/types'

function makeNote(input: Partial<Note> & { id: string; title: string }): Note {
  const now = Date.now()
  return {
    content: '',
    folderId: null,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: null,
    gitLastPushedSha: null,
    gitRemoteBaseSha: null,
    ...input,
  }
}

describe('pushPath', () => {
  test('NEW note (no gitPath) derives a fresh path from the relaxed sanitizer', () => {
    const note = makeNote({ id: '1', title: 'R&D Work' })
    expect(note.gitPath).toBeNull()
    // The relaxed sanitizer keeps `&`, so a brand-new note gets the legal path.
    expect(pushPath(note, [])).toBe('R&D Work.md')
    expect(pushPath(note, [])).toBe(notePath(note, []))
  })

  test('SYNCED note uses its existing gitPath VERBATIM (no churn for &/apostrophe)', () => {
    // Cloned from a real vault: gitPath is the actual remote path. Title agrees
    // under the relaxed sanitizer, so we keep gitPath verbatim — zero rename.
    const amp = makeNote({ id: '2', title: 'R&D Work', gitPath: 'R&D Work.md' })
    expect(pushPath(amp, [])).toBe('R&D Work.md')

    const apos = makeNote({ id: '3', title: "Jake's project", gitPath: "Jake's project.md" })
    expect(pushPath(apos, [])).toBe("Jake's project.md")
  })

  test('SYNCED note in a folder with `&` keeps its folder-qualified gitPath verbatim', () => {
    const folders: Folder[] = [
      { id: 'f1', name: 'Users & groups', parentId: null, createdAt: 0, isDeleted: false } as Folder,
    ]
    const note = makeNote({
      id: '4',
      title: 'Roles',
      folderId: 'f1',
      gitPath: 'Users & groups/Roles.md',
    })
    expect(pushPath(note, folders)).toBe('Users & groups/Roles.md')
  })

  test('GENUINE rename (title changed) derives the new path so the move propagates', () => {
    // The user renamed the note: title is now "Renamed" but gitPath still points
    // at the old file. pushPath must return the NEW derived path so the push
    // relocates the remote file (and the deletion loop drops the old one).
    const note = makeNote({ id: '5', title: 'Renamed', gitPath: 'Original.md' })
    expect(pushPath(note, [])).toBe('Renamed.md')
    expect(pushPath(note, [])).not.toBe(note.gitPath)
  })

  test('GENUINE move (folder changed) derives the new folder-qualified path', () => {
    const folders: Folder[] = [
      { id: 'f1', name: 'Archive', parentId: null, createdAt: 0, isDeleted: false } as Folder,
    ]
    // Note now lives in folder f1 but gitPath is still the old root path.
    const note = makeNote({ id: '6', title: 'Doc', folderId: 'f1', gitPath: 'Doc.md' })
    expect(pushPath(note, folders)).toBe('Archive/Doc.md')
  })
})
