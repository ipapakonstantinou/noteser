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
import type { SyncChange } from '../utils/syncChanges'

function ch(id: string, gitPath: string | null, title = id): SyncChange {
  return { noteId: id, gitPath, title, kind: 'modified' }
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

test('a note with null gitPath uses its title as the file segment', () => {
  // Newly-created notes have no gitPath yet — they should still
  // appear at the root level keyed by title (no synthetic folder
  // chain just because the title contains slashes / etc).
  const root = groupChangesByFolder(
    [ch('a', null, 'My Note')],
    [],
    [],
  )
  expect(root.children.size).toBe(0)
  expect(root.leaves.map(l => l.noteId)).toEqual(['a'])
})
