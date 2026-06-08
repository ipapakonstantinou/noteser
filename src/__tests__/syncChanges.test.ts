/**
 * syncChanges.test.ts
 *
 * Verifies the heuristic classifier used by the Source Control panel.
 * Cheap rules (no SHA compute), so the test surface is just the boolean
 * decision matrix.
 */

import { classifyPendingChanges, totalPendingCount } from '../utils/syncChanges'
import type { Note, Folder } from '@/types'

function n(input: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: input.id,
    title: input.title,
    content: input.content ?? '',
    folderId: input.folderId ?? null,
    createdAt: 0,
    updatedAt: input.updatedAt ?? 0,
    isDeleted: input.isDeleted ?? false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: input.gitPath ?? null,
    gitLastPushedSha: input.gitLastPushedSha ?? null,
    contentLoaded: input.contentLoaded,
  } as Note
}

function f(input: Partial<Folder> & { id: string; name: string }): Folder {
  return {
    id: input.id,
    name: input.name,
    parentId: input.parentId ?? null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: input.isDeleted ?? false,
    deletedAt: null,
    order: input.order ?? 0,
  } as Folder
}

describe('classifyPendingChanges', () => {
  test('returns three empty buckets for an empty input', () => {
    expect(classifyPendingChanges([], null))
      .toEqual({ created: [], modified: [], deleted: [] })
  })

  test('created: no gitPath + has content', () => {
    const c = classifyPendingChanges([n({ id: 'a', title: 'New', content: 'body' })], null)
    expect(c.created.map(x => x.title)).toEqual(['New'])
    expect(c.modified).toEqual([])
    expect(c.deleted).toEqual([])
  })

  test('empty new notes ARE surfaced as created', () => {
    // Earlier behaviour suppressed content-less notes; user
    // expectation is that a freshly-created file shows up in
    // Source Control immediately. The actual push still de-dups
    // truly-empty blobs.
    const c = classifyPendingChanges([n({ id: 'a', title: 'Blank' })], null)
    expect(c.created.map(x => x.title)).toEqual(['Blank'])
  })

  test('deleted: isDeleted + gitPath set', () => {
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Old', gitPath: 'Old.md', isDeleted: true })],
      0,
    )
    expect(c.deleted.map(x => x.title)).toEqual(['Old'])
  })

  test('isDeleted without gitPath = nothing to surface', () => {
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Phantom', isDeleted: true })],
      0,
    )
    expect(c.deleted).toEqual([])
  })

  test('modified: gitPath set + updatedAt > lastSyncedAt', () => {
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Edit', gitPath: 'Edit.md', updatedAt: 200 })],
      100,
    )
    expect(c.modified.map(x => x.title)).toEqual(['Edit'])
  })

  test('NOT modified when updatedAt <= lastSyncedAt', () => {
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Old', gitPath: 'Old.md', updatedAt: 50 })],
      100,
    )
    expect(c.modified).toEqual([])
  })

  test('gitPath set + never synced is treated as modified', () => {
    // Edge case: shouldn't happen normally, but if it does we want the
    // user to see the file so they can sort it out.
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Orphan', gitPath: 'Orphan.md', updatedAt: 50 })],
      null,
    )
    expect(c.modified.map(x => x.title)).toEqual(['Orphan'])
  })

  test('a not-yet-loaded shell is NEVER pending, even with updatedAt > lastSyncedAt', () => {
    // Regression: progressive-clone shells were miscounted as pending ("530
    // pending" right after a clone). A shell (contentLoaded:false) is in sync
    // with remote by definition and must not appear in any bucket.
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Shell', gitPath: 'Shell.md', gitLastPushedSha: 'remote-sha', updatedAt: 999, contentLoaded: false } as Partial<Note> & { id: string; title: string })],
      100,
    )
    expect(totalPendingCount(c)).toBe(0)
  })

  test('buckets are sorted alphabetically by title', () => {
    const notes = [
      n({ id: '1', title: 'Charlie', content: 'x' }),
      n({ id: '2', title: 'alpha', content: 'x' }),
      n({ id: '3', title: 'Bravo', content: 'x' }),
    ]
    expect(classifyPendingChanges(notes, null).created.map(x => x.title))
      .toEqual(['alpha', 'Bravo', 'Charlie'])
  })

  test('mixed: created + modified + deleted in one batch', () => {
    const notes = [
      n({ id: '1', title: 'New', content: 'x' }),
      n({ id: '2', title: 'Edit', gitPath: 'Edit.md', updatedAt: 200 }),
      n({ id: '3', title: 'Gone', gitPath: 'Gone.md', isDeleted: true }),
      n({ id: '4', title: 'Stable', gitPath: 'Stable.md', updatedAt: 50 }),
    ]
    const c = classifyPendingChanges(notes, 100)
    expect(c.created.map(x => x.title)).toEqual(['New'])
    expect(c.modified.map(x => x.title)).toEqual(['Edit'])
    expect(c.deleted.map(x => x.title)).toEqual(['Gone'])
    expect(totalPendingCount(c)).toBe(3)
  })

  test('totalPendingCount sums all three buckets', () => {
    expect(totalPendingCount({ created: [], modified: [], deleted: [] })).toBe(0)
    const c = classifyPendingChanges(
      [
        n({ id: '1', title: 'A', content: 'x' }),
        n({ id: '2', title: 'B', content: 'x' }),
      ],
      null,
    )
    expect(totalPendingCount(c)).toBe(2)
  })
})

// fix/created-note-source-control-tree-bug: a created note (gitPath null)
// used to surface in the Source Control tree at the repo root because
// classifyPendingChanges left its gitPath null and groupChangesByFolder
// then fell back to the title (which has no `/`). When `folders` is
// threaded through, the classifier synthesises a path from the folder
// hierarchy so the panel groups the new note under the folder it'll be
// pushed to. Verified manually against the 2026-06-08 screenshot of a
// fresh "2026-06-16" daily note appearing at root instead of under
// Notes/Daily.
describe('classifyPendingChanges — synthetic gitPath for created notes', () => {
  test('created note in root folder → "<title>.md"', () => {
    const c = classifyPendingChanges(
      [n({ id: 'a', title: '2026-06-16', content: 'x' })],
      null,
      [],
    )
    expect(c.created.map(x => x.gitPath)).toEqual(['2026-06-16.md'])
  })

  test('created note in nested Notes/Daily → "Notes/Daily/<title>.md"', () => {
    const folders: Folder[] = [
      f({ id: 'notes', name: 'Notes' }),
      f({ id: 'daily', name: 'Daily', parentId: 'notes' }),
    ]
    const c = classifyPendingChanges(
      [n({ id: 'a', title: '2026-06-16', content: 'x', folderId: 'daily' })],
      null,
      folders,
    )
    expect(c.created.map(x => x.gitPath)).toEqual(['Notes/Daily/2026-06-16.md'])
  })

  test('created note with no title → "Untitled.md"', () => {
    const c = classifyPendingChanges(
      [n({ id: 'a', title: '' })],
      null,
      [],
    )
    expect(c.created.map(x => x.gitPath)).toEqual(['Untitled.md'])
  })

  test('modified note with existing gitPath → unchanged', () => {
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Edit', gitPath: 'Notes/Edit.md', updatedAt: 200 })],
      100,
      [f({ id: 'somewhere', name: 'Somewhere' })],
    )
    // Stored gitPath wins — synthetic derivation only fires for created notes.
    expect(c.modified.map(x => x.gitPath)).toEqual(['Notes/Edit.md'])
  })

  test('created note: folders=undefined falls back to bare "<title>.md" (legacy callers)', () => {
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Standalone', content: 'x', folderId: 'orphan' })],
      null,
    )
    expect(c.created.map(x => x.gitPath)).toEqual(['Standalone.md'])
  })

  test('created note whose folderId points to a deleted folder → stops the walk', () => {
    // A folder mid-walk that's been soft-deleted shouldn't pollute the
    // synthetic path. Walk halts at the deleted folder, leaving any
    // higher ancestors out — matches buildFolderPath's behaviour.
    const folders: Folder[] = [
      f({ id: 'parent', name: 'Parent' }),
      f({ id: 'child', name: 'Child', parentId: 'parent', isDeleted: true }),
    ]
    const c = classifyPendingChanges(
      [n({ id: 'a', title: 'Stray', content: 'x', folderId: 'child' })],
      null,
      folders,
    )
    // Walk halts at 'child' (deleted) → only filename remains.
    expect(c.created.map(x => x.gitPath)).toEqual(['Stray.md'])
  })
})
