/**
 * trashFolderName.test.tsx
 *
 * #27 — the synthetic ".trash" sidebar row name is user-configurable
 * (Settings → General/Vault). Renaming is cosmetic: the row keeps its fixed
 * synthetic identity (TRASH_FOLDER_ID) so trashed notes stay trashed.
 *
 * idb-keyval is mocked so the Zustand persist middleware doesn't hit
 * IndexedDB (unavailable in jsdom).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { FolderTree } from '../components/sidebar/FolderTree'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { Note } from '../types'

function deletedNote(): Note {
  const now = Date.now()
  return {
    id: 'trashed-1',
    title: 'Old note',
    content: 'gone',
    folderId: null,
    createdAt: now,
    updatedAt: now,
    isDeleted: true,
    deletedAt: now,
    isPinned: false,
    templateId: null,
  }
}

function renderTree() {
  useNoteStore.setState({ notes: [deletedNote()], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  useUIStore.setState({ currentView: 'notes' })
  return render(<FolderTree onRightClick={() => {}} />)
}

beforeEach(() => {
  useSettingsStore.setState({ trashFolderName: '.trash' })
})

describe('configurable trash folder name (#27)', () => {
  test('defaults to ".trash"', () => {
    expect(useSettingsStore.getState().trashFolderName).toBe('.trash')
  })

  test('setTrashFolderName persists the value', () => {
    useSettingsStore.getState().setTrashFolderName('.recycle')
    expect(useSettingsStore.getState().trashFolderName).toBe('.recycle')
  })

  test('synthetic trash row renders the configured name', async () => {
    useSettingsStore.setState({ trashFolderName: '.recycle' })
    renderTree()
    const row = await screen.findByTestId('trash-synthetic-folder')
    expect(row).toHaveTextContent('.recycle')
    // Identity is unchanged — still the fixed synthetic id.
    expect(row.querySelector('[data-folder-id="__trash__"]')).not.toBeNull()
  })
})
