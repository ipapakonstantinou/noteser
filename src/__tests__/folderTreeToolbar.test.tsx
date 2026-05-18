/**
 * folderTreeToolbar.test.tsx
 *
 * Verifies that the FolderTreeToolbar "New note" and "New folder" buttons
 * always create at root (folderId/parentId === null), even when
 * activeFolderId is set to a non-null value.
 *
 * idb-keyval is mocked so the Zustand persist middleware doesn't hit
 * IndexedDB (unavailable in jsdom).
 */

// ── idb-keyval mock ───────────────────────────────────────────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FolderTreeToolbar } from '../components/sidebar/FolderTreeToolbar'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

// ── state reset helpers ───────────────────────────────────────────────────────

function resetNoteStore() {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
}

function resetFolderStore() {
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
}

function resetWorkspaceStore() {
  const emptyPane = { id: 'test-pane', tabs: [], activeTabId: null }
  useWorkspaceStore.setState({ panes: [emptyPane], activePaneId: null, mergeAppliedCount: 0 })
}

beforeEach(() => {
  resetNoteStore()
  resetFolderStore()
  resetWorkspaceStore()
})

// =============================================================================
// "New note" button
// =============================================================================

describe('FolderTreeToolbar — New note button', () => {
  test('button is present with accessible title', () => {
    render(<FolderTreeToolbar />)
    expect(screen.getByTitle('New note (Alt+N)')).toBeInTheDocument()
  })

  test('creates a new note when clicked', async () => {
    const user = userEvent.setup()
    render(<FolderTreeToolbar />)

    await user.click(screen.getByTitle('New note (Alt+N)'))

    expect(useNoteStore.getState().notes).toHaveLength(1)
  })

  test('new note has folderId === null (root) even when activeFolderId is set', async () => {
    // Simulate an active folder selection in the sidebar.
    useFolderStore.setState({ activeFolderId: 'folder-abc' })

    const user = userEvent.setup()
    render(<FolderTreeToolbar />)

    await user.click(screen.getByTitle('New note (Alt+N)'))

    const { notes } = useNoteStore.getState()
    expect(notes).toHaveLength(1)
    expect(notes[0].folderId).toBeNull()
  })

  test('new note is opened in the workspace (a tab is created)', async () => {
    const user = userEvent.setup()
    render(<FolderTreeToolbar />)

    await user.click(screen.getByTitle('New note (Alt+N)'))

    const { notes } = useNoteStore.getState()
    const noteId = notes[0].id
    const { panes } = useWorkspaceStore.getState()
    const allTabs = panes.flatMap(p => p.tabs)
    const noteTab = allTabs.find(t => t.kind === 'note' && t.noteId === noteId)
    expect(noteTab).toBeDefined()
  })

  test('new note tab is not a preview tab (preview: false)', async () => {
    const user = userEvent.setup()
    render(<FolderTreeToolbar />)

    await user.click(screen.getByTitle('New note (Alt+N)'))

    const { notes } = useNoteStore.getState()
    const noteId = notes[0].id
    const { panes } = useWorkspaceStore.getState()
    const allTabs = panes.flatMap(p => p.tabs)
    const noteTab = allTabs.find(t => t.kind === 'note' && t.noteId === noteId)
    expect(noteTab?.kind === 'note' && noteTab.isPreview).toBe(false)
  })
})

// =============================================================================
// "New folder" button
// =============================================================================

describe('FolderTreeToolbar — New folder button', () => {
  test('button is present with accessible title', () => {
    render(<FolderTreeToolbar />)
    expect(screen.getByTitle('New folder (Ctrl+Shift+N)')).toBeInTheDocument()
  })

  test('creates a new folder when clicked', async () => {
    const user = userEvent.setup()
    render(<FolderTreeToolbar />)

    await user.click(screen.getByTitle('New folder (Ctrl+Shift+N)'))

    expect(useFolderStore.getState().folders).toHaveLength(1)
  })

  test('new folder has parentId === null (root) even when activeFolderId is set', async () => {
    // Simulate an active folder selection in the sidebar.
    useFolderStore.setState({ activeFolderId: 'folder-abc' })

    const user = userEvent.setup()
    render(<FolderTreeToolbar />)

    await user.click(screen.getByTitle('New folder (Ctrl+Shift+N)'))

    const { folders } = useFolderStore.getState()
    expect(folders).toHaveLength(1)
    expect(folders[0].parentId).toBeNull()
  })

  test('clicking multiple times creates multiple root folders', async () => {
    const user = userEvent.setup()
    render(<FolderTreeToolbar />)

    const btn = screen.getByTitle('New folder (Ctrl+Shift+N)')
    await user.click(btn)
    await user.click(btn)

    const { folders } = useFolderStore.getState()
    expect(folders).toHaveLength(2)
    expect(folders.every(f => f.parentId === null)).toBe(true)
  })
})
