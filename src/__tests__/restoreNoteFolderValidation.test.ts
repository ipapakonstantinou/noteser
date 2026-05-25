/**
 * restoreNoteFolderValidation.test.ts
 *
 * restoreNote must not resurrect a note into a folder that no longer
 * exists (deleted entirely) or is soft-deleted — that would orphan the
 * note (it renders under no folder in the tree). In those cases the note
 * falls back to root (folderId: null). When the folder is still alive the
 * note returns to it unchanged.
 *
 * idb-keyval is mocked so the Zustand persist middleware doesn't hit
 * IndexedDB (unavailable in jsdom).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], deletedFolderPaths: [], activeFolderId: null })
})

describe('restoreNote — folder validation', () => {
  test('restores into the original folder when it still exists', () => {
    const folder = useFolderStore.getState().addFolder({ name: 'Project' })
    const note = useNoteStore.getState().addNote({ title: 'n', folderId: folder.id })
    useNoteStore.getState().deleteNote(note.id)

    useNoteStore.getState().restoreNote(note.id)

    const restored = useNoteStore.getState().notes.find(n => n.id === note.id)!
    expect(restored.isDeleted).toBe(false)
    expect(restored.deletedAt).toBeNull()
    expect(restored.folderId).toBe(folder.id)
  })

  test('falls back to root when the original folder is soft-deleted', () => {
    const folder = useFolderStore.getState().addFolder({ name: 'Project' })
    const note = useNoteStore.getState().addNote({ title: 'n', folderId: folder.id })
    useNoteStore.getState().deleteNote(note.id)
    // Folder soft-deleted while the note sat in the trash.
    useFolderStore.getState().deleteFolder(folder.id)

    useNoteStore.getState().restoreNote(note.id)

    const restored = useNoteStore.getState().notes.find(n => n.id === note.id)!
    expect(restored.isDeleted).toBe(false)
    expect(restored.folderId).toBeNull()
  })

  test('falls back to root when the original folder was dropped entirely', () => {
    const folder = useFolderStore.getState().addFolder({ name: 'Project' })
    const note = useNoteStore.getState().addNote({ title: 'n', folderId: folder.id })
    useNoteStore.getState().deleteNote(note.id)
    // Folder permanently deleted (no longer in the folders array at all).
    useFolderStore.getState().permanentlyDeleteFolder(folder.id)

    useNoteStore.getState().restoreNote(note.id)

    const restored = useNoteStore.getState().notes.find(n => n.id === note.id)!
    expect(restored.isDeleted).toBe(false)
    expect(restored.folderId).toBeNull()
  })

  test('a root note (folderId null) restores to root untouched', () => {
    const note = useNoteStore.getState().addNote({ title: 'n', folderId: null })
    useNoteStore.getState().deleteNote(note.id)

    useNoteStore.getState().restoreNote(note.id)

    const restored = useNoteStore.getState().notes.find(n => n.id === note.id)!
    expect(restored.isDeleted).toBe(false)
    expect(restored.folderId).toBeNull()
  })
})
