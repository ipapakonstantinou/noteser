/**
 * contextMenuCompare.test.tsx
 *
 * VS Code-style "Select for Compare" / "Compare with Selected" entries
 * on the note context menu. The two items appear/disappear based on:
 *   - whether a compare source is set (uiStore.compareSourceNoteId)
 *   - whether the right-click target is the same note as the source
 *   - whether the target is trashed
 *
 * Clicking "Compare with Selected" calls workspaceStore.openCompare and
 * auto-clears the source so the tree highlight goes away.
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
import { useWorkspaceStore } from '../stores/workspaceStore'
import type { ContextMenuState } from '@/types'

function renderMenu(state: NonNullable<ContextMenuState>, onClose = jest.fn()) {
  return render(<ContextMenu contextMenu={state} onClose={onClose} />)
}

function seedNotes() {
  useNoteStore.setState({
    notes: [
      {
        id: 'note-a',
        title: 'Note A',
        content: 'aaa',
        folderId: null,
        createdAt: 1,
        updatedAt: 1,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      },
      {
        id: 'note-b',
        title: 'Note B',
        content: 'bbb',
        folderId: null,
        createdAt: 1,
        updatedAt: 1,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      },
      {
        id: 'note-trashed',
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
}

beforeEach(() => {
  seedNotes()
  useFolderStore.setState({ folders: [], deletedFolderPaths: [], activeFolderId: null })
  useUIStore.setState({ modal: { type: null }, compareSourceNoteId: null })
  useSettingsStore.setState({ aiProvider: 'off' })
  useGitHubStore.setState({ token: null, user: null })
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
})

describe('ContextMenu — Select for Compare', () => {
  test('Select for Compare is always present on an active note', () => {
    renderMenu({ type: 'note', id: 'note-a', x: 10, y: 10 })
    expect(screen.getByText('Select for Compare')).toBeInTheDocument()
  })

  test('Compare with Selected is hidden when no source is set', () => {
    renderMenu({ type: 'note', id: 'note-a', x: 10, y: 10 })
    expect(screen.queryByText('Compare with Selected')).not.toBeInTheDocument()
  })

  test('clicking Select for Compare records the source id', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    renderMenu({ type: 'note', id: 'note-a', x: 10, y: 10 }, onClose)

    await user.click(screen.getByText('Select for Compare'))

    expect(useUIStore.getState().compareSourceNoteId).toBe('note-a')
    expect(onClose).toHaveBeenCalled()
  })

  test('Select for Compare is hidden on a trashed note', () => {
    renderMenu({ type: 'note', id: 'note-trashed', x: 10, y: 10 })
    expect(screen.queryByText('Select for Compare')).not.toBeInTheDocument()
  })
})

describe('ContextMenu — Compare with Selected', () => {
  test('appears when a different note is the source', () => {
    useUIStore.setState({ compareSourceNoteId: 'note-a' })
    renderMenu({ type: 'note', id: 'note-b', x: 10, y: 10 })
    expect(screen.getByText('Compare with Selected')).toBeInTheDocument()
  })

  test('is hidden when right-clicking the SAME note as the source', () => {
    useUIStore.setState({ compareSourceNoteId: 'note-a' })
    renderMenu({ type: 'note', id: 'note-a', x: 10, y: 10 })
    expect(screen.queryByText('Compare with Selected')).not.toBeInTheDocument()
  })

  test('is hidden on a trashed note even when a source is set', () => {
    useUIStore.setState({ compareSourceNoteId: 'note-a' })
    renderMenu({ type: 'note', id: 'note-trashed', x: 10, y: 10 })
    expect(screen.queryByText('Compare with Selected')).not.toBeInTheDocument()
  })

  test('clicking it opens a compare tab and clears the source', async () => {
    const user = userEvent.setup()
    useUIStore.setState({ compareSourceNoteId: 'note-a' })
    renderMenu({ type: 'note', id: 'note-b', x: 10, y: 10 })

    await user.click(screen.getByText('Compare with Selected'))

    // Source cleared.
    expect(useUIStore.getState().compareSourceNoteId).toBeNull()
    // A compare tab opened in the active pane with the right ids.
    const tabs = useWorkspaceStore.getState().panes[0].tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0].kind).toBe('compare')
    if (tabs[0].kind !== 'compare') throw new Error('expected compare tab')
    expect(tabs[0].leftNoteId).toBe('note-a')
    expect(tabs[0].rightNoteId).toBe('note-b')
  })
})
