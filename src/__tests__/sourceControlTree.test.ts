/**
 * sourceControlTree.test.ts
 *
 * Pure-function tests for groupChangesByFolder — the helper that
 * turns flat created/modified/deleted classifications into the
 * collapsible folder tree shown in the VS Code-style Source Control
 * panel. Render-side behaviour is exercised manually; here we lock
 * down the shape of the resulting tree.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { groupChangesByFolder } from '../components/sidebar/SourceControlPanel'
import { classifyPendingChanges, type SyncChange } from '../utils/syncChanges'
import type { Note, Folder } from '@/types'

function ch(id: string, gitPath: string | null, title = id): SyncChange {
  return { noteId: id, gitPath, title, kind: 'modified' }
}

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

test('flat root files land in the root.leaves array', () => {
  const root = groupChangesByFolder(
    [],
    [ch('a', 'A.md'), ch('b', 'B.md')],
    [],
  )
  expect(root.leaves).toHaveLength(2)
  expect(root.children.size).toBe(0)
  expect(root.leaves.map(l => l.noteId).sort()).toEqual(['a', 'b'])
})

test('nested gitPath builds a folder chain', () => {
  const root = groupChangesByFolder(
    [],
    [ch('w', 'Notes/Weekly/2026-W11.md')],
    [],
  )
  expect(root.children.has('Notes')).toBe(true)
  const notes = root.children.get('Notes')!
  expect(notes.children.has('Weekly')).toBe(true)
  const weekly = notes.children.get('Weekly')!
  expect(weekly.leaves.map(l => l.noteId)).toEqual(['w'])
  // The deepest level stops short of the filename — it's a leaf.
  expect(weekly.children.size).toBe(0)
})

test('siblings in the same folder share the folder node', () => {
  const root = groupChangesByFolder(
    [],
    [
      ch('a', 'Notes/A.md'),
      ch('b', 'Notes/B.md'),
    ],
    [],
  )
  const notes = root.children.get('Notes')!
  expect(notes.leaves.map(l => l.noteId).sort()).toEqual(['a', 'b'])
  // Only ONE Notes node — not duplicated.
  expect(root.children.size).toBe(1)
})

test('kind is preserved per leaf across the three input arrays', () => {
  const root = groupChangesByFolder(
    [ch('a', 'A.md')],
    [ch('b', 'B.md')],
    [ch('c', 'C.md')],
  )
  const byId = new Map(root.leaves.map(l => [l.noteId, l.kind]))
  expect(byId.get('a')).toBe('created')
  expect(byId.get('b')).toBe('modified')
  expect(byId.get('c')).toBe('deleted')
})

test('a SyncChange with null gitPath falls back to the title at the root', () => {
  // Unit-level guarantee about groupChangesByFolder itself: when given a
  // null-gitPath input directly, it still groups by title at root (no
  // synthetic chain just because the title might contain slashes). The
  // integration test below exercises the real path — classifyPendingChanges
  // now populates a synthetic gitPath from the folder hierarchy so this
  // null-input case shouldn't happen in production for a folder-aware
  // caller. Kept to lock down the helper's pure behaviour.
  const root = groupChangesByFolder(
    [ch('a', null, 'My Note')],
    [],
    [],
  )
  expect(root.children.size).toBe(0)
  expect(root.leaves.map(l => l.noteId)).toEqual(['a'])
})

// fix/created-note-source-control-tree-bug: integration test covering
// the real production path. A newly-created daily note in Notes/Daily
// must nest under that folder in the tree (not pile up at the repo root)
// even though its `Note.gitPath` is null. The fix lives in
// classifyPendingChanges, which synthesises a gitPath from the folder
// hierarchy when folders are supplied.
test('created note in a nested folder nests under that folder in the tree', () => {
  const folders: Folder[] = [
    f({ id: 'notes', name: 'Notes' }),
    f({ id: 'daily', name: 'Daily', parentId: 'notes' }),
  ]
  const notes: Note[] = [
    // A newly-created daily note: no gitPath yet.
    n({ id: 'today', title: '2026-06-16', content: 'today', folderId: 'daily' }),
    // A modified note that's already pushed — should also nest correctly.
    n({ id: 'yest',  title: '2026-06-07', content: 'yest', folderId: 'daily', gitPath: 'Notes/Daily/2026-06-07.md', updatedAt: 200 }),
  ]
  const changes = classifyPendingChanges(notes, 100, folders)
  const root = groupChangesByFolder(changes.created, changes.modified, changes.deleted)

  // Nothing should land at root — both notes belong inside Notes/Daily.
  expect(root.leaves).toEqual([])
  expect(root.children.has('Notes')).toBe(true)
  const notesNode = root.children.get('Notes')!
  expect(notesNode.leaves).toEqual([])
  expect(notesNode.children.has('Daily')).toBe(true)
  const dailyNode = notesNode.children.get('Daily')!
  const ids = dailyNode.leaves.map(l => l.noteId).sort()
  expect(ids).toEqual(['today', 'yest'])
  // And the kinds came through as expected.
  const byId = new Map(dailyNode.leaves.map(l => [l.noteId, l.kind]))
  expect(byId.get('today')).toBe('created')
  expect(byId.get('yest')).toBe('modified')
})
