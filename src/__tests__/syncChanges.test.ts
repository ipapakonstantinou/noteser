/**
 * syncChanges.test.ts
 *
 * Verifies the heuristic classifier used by the Source Control panel.
 * Cheap rules (no SHA compute), so the test surface is just the boolean
 * decision matrix.
 */

import { classifyPendingChanges, totalPendingCount } from '../utils/syncChanges'
import type { Note } from '@/types'

function n(input: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: input.id,
    title: input.title,
    content: input.content ?? '',
    folderId: null,
    createdAt: 0,
    updatedAt: input.updatedAt ?? 0,
    isDeleted: input.isDeleted ?? false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: input.gitPath ?? null,
    gitLastPushedSha: input.gitLastPushedSha ?? null,
  } as Note
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

  test('empty notes are NOT surfaced as created', () => {
    const c = classifyPendingChanges([n({ id: 'a', title: 'Blank' })], null)
    expect(c.created).toEqual([])
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
