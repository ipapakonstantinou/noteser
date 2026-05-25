/**
 * trashFolderActions.test.ts
 *
 * The store-level bulk actions that back folder-level trash actions:
 *   - restoreFolders + restoreNotes: restoring a trashed folder revives
 *     the folder subtree AND its notes, leaving folderIds intact so notes
 *     land back inside the folder (not relocated to root).
 *   - permanentlyDeleteFolders + permanentlyDeleteNotes: hard-removes the
 *     folder subtree and its notes.
 * Also confirms restoreFolders drops the folder's tombstoned path from
 * deletedFolderPaths.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
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

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], deletedFolderPaths: [], activeFolderId: null, expandedFolders: {} })
})

describe('restoreFolders + restoreNotes (folder restore)', () => {
  test('revives the folder subtree and its notes, keeping folderIds', () => {
    useFolderStore.setState({
      folders: [
        folder({ id: 'p', name: 'Parent', isDeleted: true, deletedAt: 1 }),
        folder({ id: 'c', name: 'Child', parentId: 'p', isDeleted: true, deletedAt: 1 }),
      ],
      deletedFolderPaths: ['Parent', 'Parent/Child'],
    })
    useNoteStore.setState({
      notes: [
        note({ id: 'pn', title: 'p note', folderId: 'p', isDeleted: true, deletedAt: 1 }),
        note({ id: 'cn', title: 'c note', folderId: 'c', isDeleted: true, deletedAt: 1 }),
      ],
      selectedNoteId: null,
    })

    useFolderStore.getState().restoreFolders(['p', 'c'])
    useNoteStore.getState().restoreNotes(['pn', 'cn'])

    const folders = useFolderStore.getState().folders
    expect(folders.find(f => f.id === 'p')?.isDeleted).toBe(false)
    expect(folders.find(f => f.id === 'c')?.isDeleted).toBe(false)

    const notes = useNoteStore.getState().notes
    const pn = notes.find(n => n.id === 'pn')
    const cn = notes.find(n => n.id === 'cn')
    expect(pn?.isDeleted).toBe(false)
    expect(pn?.folderId).toBe('p') // stayed in its folder, not relocated to root
    expect(cn?.isDeleted).toBe(false)
    expect(cn?.folderId).toBe('c')

    // Both tombstoned paths dropped.
    expect(useFolderStore.getState().deletedFolderPaths).toEqual([])
  })
})

describe('permanentlyDeleteFolders + permanentlyDeleteNotes', () => {
  test('hard-removes the folder subtree and its notes', () => {
    useFolderStore.setState({
      folders: [
        folder({ id: 'p', name: 'Parent', isDeleted: true, deletedAt: 1 }),
        folder({ id: 'c', name: 'Child', parentId: 'p', isDeleted: true, deletedAt: 1 }),
        folder({ id: 'keep', name: 'Keep' }),
      ],
    })
    useNoteStore.setState({
      notes: [
        note({ id: 'pn', title: 'p note', folderId: 'p', isDeleted: true, deletedAt: 1 }),
        note({ id: 'cn', title: 'c note', folderId: 'c', isDeleted: true, deletedAt: 1 }),
        note({ id: 'live', title: 'live', folderId: 'keep' }),
      ],
      selectedNoteId: null,
    })

    useNoteStore.getState().permanentlyDeleteNotes(['pn', 'cn'])
    useFolderStore.getState().permanentlyDeleteFolders(['p', 'c'])

    expect(useFolderStore.getState().folders.map(f => f.id)).toEqual(['keep'])
    expect(useNoteStore.getState().notes.map(n => n.id)).toEqual(['live'])
  })
})
