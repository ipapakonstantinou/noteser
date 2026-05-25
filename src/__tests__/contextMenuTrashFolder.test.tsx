/**
 * contextMenuTrashFolder.test.tsx
 *
 * Right-clicking the synthetic ".trash" folder (reserved id
 * TRASH_FOLDER_ID) must render a trash-ONLY menu: a single "Empty Trash"
 * action and none of the normal folder actions (New note / New subfolder
 * / Rename / cascade Delete). Clicking it routes through the
 * DeleteConfirmModal "Empty Trash?" flow (openModal with type:'folder',
 * id:TRASH_FOLDER_ID), which empties the trash without ever touching
 * deletedFolderPaths.
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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ContextMenu } from '../components/sidebar/ContextMenu'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useGitHubStore } from '../stores/githubStore'
import { TRASH_FOLDER_ID } from '../utils/systemFolder'
import type { ContextMenuState } from '@/types'

const trashMenuState: NonNullable<ContextMenuState> = {
  type: 'folder',
  id: TRASH_FOLDER_ID,
  x: 100,
  y: 100,
}

function renderMenu(state: NonNullable<ContextMenuState>, onClose = jest.fn()) {
  return render(<ContextMenu contextMenu={state} onClose={onClose} />)
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], deletedFolderPaths: [], activeFolderId: null })
  useUIStore.setState({ modal: { type: null } })
  useSettingsStore.setState({ aiProvider: 'off' })
  useGitHubStore.setState({ token: null, user: null })
})

describe('ContextMenu — synthetic .trash folder', () => {
  test('shows ONLY an "Empty Trash" action, not the normal folder actions', () => {
    renderMenu(trashMenuState)

    expect(screen.getByText('Empty Trash')).toBeInTheDocument()
    // None of the standard folder/note actions appear.
    expect(screen.queryByText('New note in folder')).not.toBeInTheDocument()
    expect(screen.queryByText('New subfolder')).not.toBeInTheDocument()
    expect(screen.queryByText('Rename')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  test('renders even though .trash has no backing Folder entity', () => {
    // No folder with id TRASH_FOLDER_ID exists — the menu must still render
    // (the normal `if (!item) return null` guard would have hidden it).
    expect(useFolderStore.getState().getFolderById(TRASH_FOLDER_ID)).toBeUndefined()
    renderMenu(trashMenuState)
    expect(screen.getByTestId('context-menu-empty-trash')).toBeInTheDocument()
  })

  test('clicking "Empty Trash" opens the delete modal for TRASH_FOLDER_ID', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    renderMenu(trashMenuState, onClose)

    await user.click(screen.getByTestId('context-menu-empty-trash'))

    const modal = useUIStore.getState().modal
    expect(modal.type).toBe('delete')
    expect(modal.data).toEqual({ type: 'folder', id: TRASH_FOLDER_ID })
    expect(onClose).toHaveBeenCalled()
    // The menu only opens the confirm modal — it never mutates
    // deletedFolderPaths itself.
    expect(useFolderStore.getState().deletedFolderPaths).toEqual([])
  })
})

describe('ContextMenu — trashed note actions', () => {
  test('a trashed note shows Restore + "Permanently Delete"', () => {
    useNoteStore.setState({
      notes: [
        {
          id: 'trashed-1',
          title: 'gone',
          content: '',
          folderId: null,
          createdAt: 1,
          updatedAt: 1,
          isDeleted: true,
          deletedAt: 1,
          isPinned: false,
          templateId: null,
        },
      ],
      selectedNoteId: null,
    })

    renderMenu({ type: 'note', id: 'trashed-1', x: 10, y: 10 })

    expect(screen.getByText('Restore')).toBeInTheDocument()
    expect(screen.getByText('Permanently Delete')).toBeInTheDocument()
  })

  test('clicking "Permanently Delete" opens the modal with permanent:true', async () => {
    const user = userEvent.setup()
    useNoteStore.setState({
      notes: [
        {
          id: 'trashed-2',
          title: 'gone',
          content: '',
          folderId: null,
          createdAt: 1,
          updatedAt: 1,
          isDeleted: true,
          deletedAt: 1,
          isPinned: false,
          templateId: null,
        },
      ],
      selectedNoteId: null,
    })
    renderMenu({ type: 'note', id: 'trashed-2', x: 10, y: 10 })

    await user.click(screen.getByText('Permanently Delete'))

    const modal = useUIStore.getState().modal
    expect(modal.type).toBe('delete')
    expect(modal.data).toEqual({ type: 'note', id: 'trashed-2', permanent: true })
  })
})
