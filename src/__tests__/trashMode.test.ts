/**
 * trashMode.test.ts
 *
 * Verifies that noteStore.deleteNote respects the user's trashMode
 * setting — 'trash' (default) soft-deletes; 'hardDelete' removes
 * immediately.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { useNoteStore } from '../stores/noteStore'
import { useSettingsStore } from '../stores/settingsStore'

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useSettingsStore.getState().setTrashMode('trash')
})

describe('deleteNote — respects trashMode', () => {
  test('trashMode = "trash" soft-deletes the note (still recoverable)', () => {
    const note = useNoteStore.getState().addNote({ title: 'a', content: '' })
    useNoteStore.getState().deleteNote(note.id)
    const after = useNoteStore.getState().notes.find(n => n.id === note.id)
    expect(after?.isDeleted).toBe(true)
    expect(after?.deletedAt).not.toBeNull()
  })

  test('trashMode = "hardDelete" removes the note entry entirely', () => {
    useSettingsStore.getState().setTrashMode('hardDelete')
    const note = useNoteStore.getState().addNote({ title: 'a', content: '' })
    useNoteStore.getState().deleteNote(note.id)
    const exists = useNoteStore.getState().notes.find(n => n.id === note.id)
    expect(exists).toBeUndefined()
  })

  test('switching back to "trash" after a hard-delete only affects subsequent deletes', () => {
    useSettingsStore.getState().setTrashMode('hardDelete')
    const noteA = useNoteStore.getState().addNote({ title: 'a' })
    useNoteStore.getState().deleteNote(noteA.id)
    expect(useNoteStore.getState().notes.find(n => n.id === noteA.id)).toBeUndefined()

    useSettingsStore.getState().setTrashMode('trash')
    const noteB = useNoteStore.getState().addNote({ title: 'b' })
    useNoteStore.getState().deleteNote(noteB.id)
    const after = useNoteStore.getState().notes.find(n => n.id === noteB.id)
    expect(after?.isDeleted).toBe(true)
  })

  test('hardDelete also clears selectedNoteId if the deleted note was selected', () => {
    useSettingsStore.getState().setTrashMode('hardDelete')
    const note = useNoteStore.getState().addNote({ title: 'sel' })
    useNoteStore.getState().selectNote(note.id)
    useNoteStore.getState().deleteNote(note.id)
    expect(useNoteStore.getState().selectedNoteId).toBeNull()
  })
})
