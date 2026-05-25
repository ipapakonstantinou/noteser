/**
 * deleteConfirmModalTrash.test.tsx
 *
 * Fix 1 — the synthetic ".trash" folder must not be cascade/permanent-
 * deleted (which would tombstone a `.trash` path AND leave the trashed
 * notes alive → a duplicate empty `.trash` re-renders). "Deleting" the
 * trash empties it: hard-delete every soft-deleted note, and
 * deletedFolderPaths must stay untouched.
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

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'

import { DeleteConfirmModal } from '../components/modals/DeleteConfirmModal'
import { useUIStore } from '../stores/uiStore'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { TRASH_FOLDER_ID } from '../utils/systemFolder'

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], deletedFolderPaths: [], activeFolderId: null })
  useUIStore.getState().closeModal()
})

describe('DeleteConfirmModal — synthetic .trash folder', () => {
  test('shows "Empty Trash" copy for the __trash__ folder id', () => {
    // Two soft-deleted notes sitting in the trash.
    const a = useNoteStore.getState().addNote({ title: 'a', content: '' })
    const b = useNoteStore.getState().addNote({ title: 'b', content: '' })
    useNoteStore.getState().deleteNote(a.id)
    useNoteStore.getState().deleteNote(b.id)

    useUIStore.getState().openModal({
      type: 'delete',
      data: { type: 'folder', id: TRASH_FOLDER_ID },
    })
    render(<DeleteConfirmModal />)

    expect(screen.getByText('Empty Trash?')).toBeInTheDocument()
    // Mentions the count of trashed notes.
    expect(screen.getByText(/2 notes in the trash/)).toBeInTheDocument()
  })

  test('confirming empties the trash and leaves deletedFolderPaths untouched', () => {
    const a = useNoteStore.getState().addNote({ title: 'a', content: '' })
    const b = useNoteStore.getState().addNote({ title: 'b', content: '' })
    const live = useNoteStore.getState().addNote({ title: 'keep', content: '' })
    useNoteStore.getState().deleteNote(a.id)
    useNoteStore.getState().deleteNote(b.id)

    useUIStore.getState().openModal({
      type: 'delete',
      data: { type: 'folder', id: TRASH_FOLDER_ID },
    })
    render(<DeleteConfirmModal />)

    fireEvent.click(screen.getByTestId('delete-confirm'))

    const notes = useNoteStore.getState().notes
    // The two trashed notes are hard-deleted; the live note survives.
    expect(notes.find(n => n.id === a.id)).toBeUndefined()
    expect(notes.find(n => n.id === b.id)).toBeUndefined()
    expect(notes.find(n => n.id === live.id)).toBeDefined()
    // Crucially: no `.trash` path leaked into deletedFolderPaths.
    expect(useFolderStore.getState().deletedFolderPaths).toEqual([])
    // Modal closed.
    expect(useUIStore.getState().modal.type).not.toBe('delete')
  })

  test('a REAL folder still cascade-deletes (regression guard)', () => {
    const folder = useFolderStore.getState().addFolder({ name: 'Project' })
    useUIStore.getState().openModal({
      type: 'delete',
      data: { type: 'folder', id: folder.id },
    })
    render(<DeleteConfirmModal />)

    expect(screen.getByText('Delete Folder?')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('delete-confirm'))

    const f = useFolderStore.getState().folders.find(x => x.id === folder.id)
    expect(f?.isDeleted).toBe(true)
  })
})
