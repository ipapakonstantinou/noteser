/**
 * trashTree.test.ts
 *
 * Pure-helper tests for the .trash hierarchy reconstruction. The soft-
 * delete data keeps every entity's original parentId / folderId, so the
 * pre-deletion shape is recoverable — buildTrashTree reassembles it for
 * the synthetic ".trash" view:
 *   - deleted note under a deleted folder nests inside that folder
 *   - deleted note with no deleted parent stays flat at the trash root
 *   - deleted subfolder nests under its deleted parent
 *   - deleted folders with no trashed contents anywhere are pruned
 * No React, no stores — folders + notes in, a TrashTree out.
 *
 * Also re-asserts that the MAIN tree flattener still EXCLUDES deleted
 * items, so this feature didn't leak tombstones into the live tree.
 */

import {
  buildTrashTree,
  collectTrashFolderIds,
  collectTrashNoteIds,
} from '../utils/trashTree'
import { getFlattenedTreeOrder } from '../utils/treeNav'
import type { Folder, Note } from '../types'

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

// Helper: filter to the deleted subsets the way the FolderTree memos do
// before calling buildTrashTree.
const deletedOnly = <T extends { isDeleted: boolean }>(items: T[]): T[] =>
  items.filter(i => i.isDeleted)

describe('buildTrashTree', () => {
  test('empty inputs yield empty tree', () => {
    expect(buildTrashTree([], [])).toEqual({ rootFolders: [], looseNotes: [] })
  })

  test('a deleted folder with deleted notes nests them inside it', () => {
    const folders = [folder({ id: 'f1', name: 'Projects', isDeleted: true, deletedAt: 1 })]
    const notes = [
      note({ id: 'n1', title: 'plan', folderId: 'f1', isDeleted: true, deletedAt: 1 }),
      note({ id: 'n2', title: 'budget', folderId: 'f1', isDeleted: true, deletedAt: 1 }),
    ]

    const tree = buildTrashTree(deletedOnly(notes), deletedOnly(folders))

    expect(tree.looseNotes).toEqual([])
    expect(tree.rootFolders).toHaveLength(1)
    const node = tree.rootFolders[0]
    expect(node.folder.id).toBe('f1')
    expect(node.notes.map(n => n.id).sort()).toEqual(['n1', 'n2'])
    expect(node.childFolders).toEqual([])
  })

  test('loose deleted notes (no deleted parent / root) stay at trash root', () => {
    const folders: Folder[] = [
      // An ACTIVE folder — its (deleted) note is loose, not nested, because
      // the folder still exists in the live tree.
      folder({ id: 'live', name: 'Live' }),
    ]
    const notes = [
      note({ id: 'root', title: 'orphan', folderId: null, isDeleted: true, deletedAt: 1 }),
      note({ id: 'fromLive', title: 'was in live', folderId: 'live', isDeleted: true, deletedAt: 1 }),
    ]

    const tree = buildTrashTree(deletedOnly(notes), deletedOnly(folders))

    expect(tree.rootFolders).toEqual([])
    expect(tree.looseNotes.map(n => n.id).sort()).toEqual(['fromLive', 'root'])
  })

  test('a deleted subfolder nests under its deleted parent, recursively', () => {
    const folders = [
      folder({ id: 'parent', name: 'Parent', isDeleted: true, deletedAt: 1 }),
      folder({ id: 'child', name: 'Child', parentId: 'parent', isDeleted: true, deletedAt: 1 }),
    ]
    const notes = [
      note({ id: 'pn', title: 'in parent', folderId: 'parent', isDeleted: true, deletedAt: 1 }),
      note({ id: 'cn', title: 'in child', folderId: 'child', isDeleted: true, deletedAt: 1 }),
    ]

    const tree = buildTrashTree(deletedOnly(notes), deletedOnly(folders))

    expect(tree.looseNotes).toEqual([])
    expect(tree.rootFolders).toHaveLength(1)
    const parent = tree.rootFolders[0]
    expect(parent.folder.id).toBe('parent')
    expect(parent.notes.map(n => n.id)).toEqual(['pn'])
    expect(parent.childFolders).toHaveLength(1)
    const child = parent.childFolders[0]
    expect(child.folder.id).toBe('child')
    expect(child.notes.map(n => n.id)).toEqual(['cn'])
  })

  test('deleted folders with no trashed contents anywhere are pruned', () => {
    const folders = [
      // Empty deleted shell — no notes, no deleted children.
      folder({ id: 'empty', name: 'Empty', isDeleted: true, deletedAt: 1 }),
      // Parent whose only deleted descendant chain is also empty.
      folder({ id: 'p', name: 'P', isDeleted: true, deletedAt: 1 }),
      folder({ id: 'c', name: 'C', parentId: 'p', isDeleted: true, deletedAt: 1 }),
    ]

    const tree = buildTrashTree(deletedOnly([]), deletedOnly(folders))

    expect(tree.rootFolders).toEqual([])
    expect(tree.looseNotes).toEqual([])
  })

  test('a deleted parent kept alive only by a note in a deleted child still renders the chain', () => {
    const folders = [
      folder({ id: 'p', name: 'P', isDeleted: true, deletedAt: 1 }),
      folder({ id: 'c', name: 'C', parentId: 'p', isDeleted: true, deletedAt: 1 }),
    ]
    const notes = [note({ id: 'cn', title: 'deep', folderId: 'c', isDeleted: true, deletedAt: 1 })]

    const tree = buildTrashTree(deletedOnly(notes), deletedOnly(folders))

    expect(tree.rootFolders).toHaveLength(1)
    expect(tree.rootFolders[0].folder.id).toBe('p')
    expect(tree.rootFolders[0].notes).toEqual([])
    expect(tree.rootFolders[0].childFolders[0].folder.id).toBe('c')
    expect(tree.rootFolders[0].childFolders[0].notes.map(n => n.id)).toEqual(['cn'])
  })

  test('child folders sort alphabetically (case-insensitive)', () => {
    const folders = [
      folder({ id: 'p', name: 'P', isDeleted: true, deletedAt: 1 }),
      folder({ id: 'cb', name: 'beta', parentId: 'p', isDeleted: true, deletedAt: 1 }),
      folder({ id: 'ca', name: 'Alpha', parentId: 'p', isDeleted: true, deletedAt: 1 }),
    ]
    const notes = [
      note({ id: 'na', title: 'a', folderId: 'ca', isDeleted: true, deletedAt: 1 }),
      note({ id: 'nb', title: 'b', folderId: 'cb', isDeleted: true, deletedAt: 1 }),
    ]

    const tree = buildTrashTree(deletedOnly(notes), deletedOnly(folders))
    const childNames = tree.rootFolders[0].childFolders.map(c => c.folder.name)
    expect(childNames).toEqual(['Alpha', 'beta'])
  })
})

describe('collectTrash* helpers', () => {
  test('collect ids over a subtree (folder + descendants)', () => {
    const folders = [
      folder({ id: 'p', name: 'P', isDeleted: true, deletedAt: 1 }),
      folder({ id: 'c', name: 'C', parentId: 'p', isDeleted: true, deletedAt: 1 }),
    ]
    const notes = [
      note({ id: 'pn', title: 'p note', folderId: 'p', isDeleted: true, deletedAt: 1 }),
      note({ id: 'cn', title: 'c note', folderId: 'c', isDeleted: true, deletedAt: 1 }),
    ]
    const tree = buildTrashTree(deletedOnly(notes), deletedOnly(folders))
    const node = tree.rootFolders[0]

    expect(collectTrashFolderIds(node).sort()).toEqual(['c', 'p'])
    expect(collectTrashNoteIds(node).sort()).toEqual(['cn', 'pn'])
  })
})

describe('main tree still excludes deleted items', () => {
  test('getFlattenedTreeOrder drops deleted folders and notes', () => {
    const folders = [
      folder({ id: 'live', name: 'Live' }),
      folder({ id: 'gone', name: 'Gone', isDeleted: true, deletedAt: 1 }),
    ]
    const notes = [
      note({ id: 'keep', title: 'keep', folderId: 'live' }),
      note({ id: 'trashed', title: 'trashed', folderId: 'gone', isDeleted: true, deletedAt: 1 }),
      note({ id: 'looseTrashed', title: 'loose', folderId: null, isDeleted: true, deletedAt: 1 }),
    ]

    const rows = getFlattenedTreeOrder(folders, notes, { live: true })
    const ids = rows.map(r => r.id)

    expect(ids).toContain('live')
    expect(ids).toContain('keep')
    expect(ids).not.toContain('gone')
    expect(ids).not.toContain('trashed')
    expect(ids).not.toContain('looseTrashed')
  })
})
