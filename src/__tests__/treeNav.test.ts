/**
 * treeNav.test.ts
 *
 * Pure-helper tests for the keyboard-navigation flattener. No React, no
 * stores — just folders + notes + an `expanded` map in, ordered rows out.
 * The render order asserted here must match what `FolderTree.tsx` paints
 * on screen so arrow-key motion lines up with what the user sees.
 */

import {
  getFlattenedTreeOrder,
  findRowIndex,
  findNextRowByLetter,
} from '../utils/treeNav'
import type { Folder, Note } from '../types'

// ── factories ──────────────────────────────────────────────────────────────
function folder(o: Partial<Folder> & { id: string; name: string }): Folder {
  return {
    id: o.id,
    name: o.name,
    parentId: o.parentId ?? null,
    createdAt: o.createdAt ?? 0,
    updatedAt: o.updatedAt ?? 0,
    isDeleted: o.isDeleted ?? false,
    deletedAt: o.deletedAt ?? null,
    order: o.order ?? 0,
  }
}

function note(o: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: o.id,
    title: o.title,
    content: o.content ?? '',
    folderId: o.folderId ?? null,
    createdAt: o.createdAt ?? 0,
    updatedAt: o.updatedAt ?? 0,
    isDeleted: o.isDeleted ?? false,
    deletedAt: o.deletedAt ?? null,
    isPinned: o.isPinned ?? false,
    templateId: o.templateId ?? null,
  }
}

// ── getFlattenedTreeOrder ─────────────────────────────────────────────────

describe('getFlattenedTreeOrder', () => {
  test('empty inputs yield an empty list', () => {
    expect(getFlattenedTreeOrder([], [], {})).toEqual([])
  })

  test('root folders sort alphabetically (case-insensitive) when collapsed', () => {
    const folders = [
      folder({ id: 'a', name: 'beta' }),
      folder({ id: 'b', name: 'Alpha' }),
      folder({ id: 'c', name: 'gamma' }),
    ]
    const rows = getFlattenedTreeOrder(folders, [], {})
    expect(rows.map(r => r.name)).toEqual(['Alpha', 'beta', 'gamma'])
    expect(rows.every(r => r.kind === 'folder' && r.depth === 0)).toBe(true)
  })

  test('collapsed folder contributes one row regardless of children', () => {
    const folders = [
      folder({ id: 'f1', name: 'Notes' }),
      folder({ id: 'f2', name: 'Inside', parentId: 'f1' }),
    ]
    const notes = [note({ id: 'n1', title: 'Hello', folderId: 'f1' })]
    const rows = getFlattenedTreeOrder(folders, notes, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'folder', id: 'f1', depth: 0 })
  })

  test('expanded folder yields children: sub-folders then notes', () => {
    const folders = [
      folder({ id: 'root', name: 'root' }),
      folder({ id: 'child', name: 'child', parentId: 'root' }),
    ]
    const notes = [
      note({ id: 'note1', title: 'leaf', folderId: 'root' }),
    ]
    const rows = getFlattenedTreeOrder(folders, notes, { root: true })
    expect(rows.map(r => ({ kind: r.kind, id: r.id, depth: r.depth }))).toEqual([
      { kind: 'folder', id: 'root',  depth: 0 },
      { kind: 'folder', id: 'child', depth: 1 },
      { kind: 'note',   id: 'note1', depth: 1 },
    ])
  })

  test('nested expansion descends recursively', () => {
    const folders = [
      folder({ id: 'a', name: 'a' }),
      folder({ id: 'b', name: 'b', parentId: 'a' }),
      folder({ id: 'c', name: 'c', parentId: 'b' }),
    ]
    const rows = getFlattenedTreeOrder(folders, [], { a: true, b: true, c: true })
    expect(rows.map(r => ({ id: r.id, depth: r.depth }))).toEqual([
      { id: 'a', depth: 0 },
      { id: 'b', depth: 1 },
      { id: 'c', depth: 2 },
    ])
  })

  test('root notes appear after all root folders', () => {
    const folders = [folder({ id: 'f1', name: 'Folder' })]
    const notes = [note({ id: 'n1', title: 'Apple' })]
    const rows = getFlattenedTreeOrder(folders, notes, {})
    expect(rows.map(r => r.id)).toEqual(['f1', 'n1'])
  })

  test('parentFolderId is correctly set on every row', () => {
    const folders = [
      folder({ id: 'root', name: 'root' }),
      folder({ id: 'child', name: 'child', parentId: 'root' }),
    ]
    const notes = [
      note({ id: 'rootNote', title: 'rootNote' }),
      note({ id: 'leafNote', title: 'leafNote', folderId: 'child' }),
    ]
    const rows = getFlattenedTreeOrder(folders, notes, { root: true, child: true })
    const byId = Object.fromEntries(rows.map(r => [r.id, r.parentFolderId]))
    expect(byId).toEqual({
      root: null,
      child: 'root',
      leafNote: 'child',
      rootNote: null,
    })
  })

  test('soft-deleted folders and notes are dropped', () => {
    const folders = [
      folder({ id: 'live', name: 'live' }),
      folder({ id: 'dead', name: 'dead', isDeleted: true }),
    ]
    const notes = [
      note({ id: 'n-live', title: 'l' }),
      note({ id: 'n-dead', title: 'd', isDeleted: true }),
    ]
    const rows = getFlattenedTreeOrder(folders, notes, {})
    expect(rows.map(r => r.id).sort()).toEqual(['live', 'n-live'])
  })

  test('hidden (dotfile) folders are filtered by default', () => {
    const folders = [
      folder({ id: 'plain', name: 'plain' }),
      folder({ id: 'dot',   name: '.attachments' }),
    ]
    const rows = getFlattenedTreeOrder(folders, [], {})
    expect(rows.map(r => r.id)).toEqual(['plain'])
  })

  test('showHiddenFolders=true keeps dotfile folders', () => {
    const folders = [
      folder({ id: 'plain', name: 'plain' }),
      folder({ id: 'dot',   name: '.attachments' }),
    ]
    const rows = getFlattenedTreeOrder(folders, [], {}, { showHiddenFolders: true })
    // Case-insensitive sort puts '.attachments' before 'plain' (dot < p).
    expect(rows.map(r => r.id)).toEqual(['dot', 'plain'])
  })

  test('notes within a folder sort by noteSortMode (alphabetical default)', () => {
    const folders = [folder({ id: 'f', name: 'f' })]
    const notes = [
      note({ id: 'z', title: 'Zebra', folderId: 'f' }),
      note({ id: 'a', title: 'apple', folderId: 'f' }),
    ]
    const rows = getFlattenedTreeOrder(folders, notes, { f: true })
    // sortNotes uses localeCompare which case-folds — 'apple' < 'Zebra'.
    expect(rows.filter(r => r.kind === 'note').map(r => r.id)).toEqual(['a', 'z'])
  })

  test('collapsing the parent hides every descendant', () => {
    const folders = [
      folder({ id: 'a', name: 'a' }),
      folder({ id: 'b', name: 'b', parentId: 'a' }),
    ]
    const notes = [note({ id: 'n', title: 'n', folderId: 'b' })]
    const rows = getFlattenedTreeOrder(folders, notes, { b: true /* a stays collapsed */ })
    expect(rows.map(r => r.id)).toEqual(['a'])
  })
})

// ── findRowIndex ──────────────────────────────────────────────────────────

describe('findRowIndex', () => {
  const folders = [
    folder({ id: 'f1', name: 'f1' }),
    folder({ id: 'f2', name: 'f2' }),
  ]
  const notes = [note({ id: 'n1', title: 'n1' })]
  const rows = getFlattenedTreeOrder(folders, notes, {})

  test('finds an existing folder row', () => {
    expect(findRowIndex(rows, 'folder', 'f2')).toBe(1)
  })

  test('finds an existing note row', () => {
    expect(findRowIndex(rows, 'note', 'n1')).toBe(2)
  })

  test('returns -1 for unknown id', () => {
    expect(findRowIndex(rows, 'folder', 'nope')).toBe(-1)
  })

  test('does not confuse note id with folder id', () => {
    expect(findRowIndex(rows, 'folder', 'n1')).toBe(-1)
  })
})

// ── findNextRowByLetter ───────────────────────────────────────────────────

describe('findNextRowByLetter', () => {
  const folders = [
    folder({ id: 'a', name: 'Apple' }),
    folder({ id: 'b', name: 'Banana' }),
    folder({ id: 'c', name: 'Cherry' }),
  ]
  const rows = getFlattenedTreeOrder(folders, [], {})

  test('jumps from -1 to the first matching row', () => {
    expect(findNextRowByLetter(rows, 'b', -1)).toBe(1)
  })

  test('case-insensitive match', () => {
    expect(findNextRowByLetter(rows, 'C', 0)).toBe(2)
  })

  test('wraps around past the end', () => {
    expect(findNextRowByLetter(rows, 'a', 2)).toBe(0)
  })

  test('does not match the current row — advances even when current also matches', () => {
    // Two rows start with "A".
    const dupRows = getFlattenedTreeOrder(
      [folder({ id: 'a1', name: 'Apple' }), folder({ id: 'a2', name: 'Apricot' })],
      [],
      {},
    )
    expect(findNextRowByLetter(dupRows, 'a', 0)).toBe(1)
    // From row 1, it wraps back to row 0.
    expect(findNextRowByLetter(dupRows, 'a', 1)).toBe(0)
  })

  test('returns -1 when no row matches', () => {
    expect(findNextRowByLetter(rows, 'z', -1)).toBe(-1)
  })

  test('returns -1 on empty rows', () => {
    expect(findNextRowByLetter([], 'a', -1)).toBe(-1)
  })
})
