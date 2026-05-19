/**
 * cascadeDelete.test.ts
 *
 * Verifies the cascade-delete-folder behaviour:
 *   - Root folder + every descendant folder gets soft-deleted.
 *   - Notes inside the deleted hierarchy move to root.
 *   - Attachments under the folder's repo path get tombstoned + dropped
 *     from IDB so the next sync removes them remotely.
 */

const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((key: string) => Promise.resolve(idb.get(key))),
  set: jest.fn((key: string, value: unknown) => { idb.set(key, value); return Promise.resolve() }),
  del: jest.fn((key: string) => { idb.delete(key); return Promise.resolve() }),
  keys: jest.fn(() => Promise.resolve([...idb.keys()])),
}))

// jsdom doesn't ship URL.createObjectURL / revokeObjectURL.
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: jest.fn(() => 'blob:test/1'), writable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', { value: jest.fn(), writable: true })
})

import { cascadeDeleteFolder } from '../utils/cascadeDelete'
import { useFolderStore } from '../stores/folderStore'
import { useNoteStore } from '../stores/noteStore'
import { putAttachmentAtPath, getAttachmentTombstones, listAttachmentPaths } from '../utils/attachments'

beforeEach(() => {
  idb.clear()
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  useNoteStore.setState({ notes: [], selectedNoteId: null })
})

describe('cascadeDeleteFolder', () => {
  test('soft-deletes the target folder', () => {
    const f = useFolderStore.getState().addFolder({ name: 'images', parentId: null })
    cascadeDeleteFolder(f.id)
    const after = useFolderStore.getState().folders.find(x => x.id === f.id)
    expect(after?.isDeleted).toBe(true)
  })

  test('soft-deletes descendant folders too', () => {
    const root = useFolderStore.getState().addFolder({ name: 'Notes', parentId: null })
    const sub = useFolderStore.getState().addFolder({ name: 'Daily', parentId: root.id })
    const subSub = useFolderStore.getState().addFolder({ name: 'Old', parentId: sub.id })

    cascadeDeleteFolder(root.id)

    const folders = useFolderStore.getState().folders
    expect(folders.find(f => f.id === root.id)?.isDeleted).toBe(true)
    expect(folders.find(f => f.id === sub.id)?.isDeleted).toBe(true)
    expect(folders.find(f => f.id === subSub.id)?.isDeleted).toBe(true)
  })

  test('moves notes from deleted folders to root', () => {
    const root = useFolderStore.getState().addFolder({ name: 'Notes', parentId: null })
    const sub = useFolderStore.getState().addFolder({ name: 'Sub', parentId: root.id })
    const noteA = useNoteStore.getState().addNote({ title: 'A', folderId: root.id, content: '' })
    const noteB = useNoteStore.getState().addNote({ title: 'B', folderId: sub.id, content: '' })

    cascadeDeleteFolder(root.id)

    const notes = useNoteStore.getState().notes
    expect(notes.find(n => n.id === noteA.id)?.folderId).toBeNull()
    expect(notes.find(n => n.id === noteB.id)?.folderId).toBeNull()
  })

  test('tombstones attachments inside the deleted folder', async () => {
    const folder = useFolderStore.getState().addFolder({ name: 'attachments', parentId: null })
    // Seed three attachments — two inside, one outside.
    await putAttachmentAtPath('attachments/foo.png', new Blob([new Uint8Array([1])], { type: 'image/png' }))
    await putAttachmentAtPath('attachments/bar.png', new Blob([new Uint8Array([2])], { type: 'image/png' }))
    await putAttachmentAtPath('elsewhere/baz.png', new Blob([new Uint8Array([3])], { type: 'image/png' }))

    cascadeDeleteFolder(folder.id)

    // The async IDB cleanup is fire-and-forget; flush the microtask queue.
    await new Promise(resolve => setTimeout(resolve, 50))

    const tombstones = await getAttachmentTombstones()
    expect(tombstones.sort()).toEqual(['attachments/bar.png', 'attachments/foo.png'])

    // The deleted ones should be gone from IDB.
    const remaining = await listAttachmentPaths()
    expect(remaining).toEqual(['elsewhere/baz.png'])
  })

  test('is a no-op when called on an already-deleted folder', () => {
    const f = useFolderStore.getState().addFolder({ name: 'x', parentId: null })
    useFolderStore.getState().deleteFolder(f.id)
    const folderCountBefore = useFolderStore.getState().folders.length
    cascadeDeleteFolder(f.id)
    const folderCountAfter = useFolderStore.getState().folders.length
    expect(folderCountAfter).toBe(folderCountBefore)
  })
})
