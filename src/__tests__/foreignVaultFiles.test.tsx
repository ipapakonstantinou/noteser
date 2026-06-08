/**
 * foreignVaultFiles.test.tsx
 *
 * Coverage for non-md vault files (`.canvas`, `.base`, etc.) we mirror in the
 * sidebar as un-openable entries. Three surfaces in this file:
 *
 *   1. FolderTree — a foreign-kind note renders with the distinct
 *      `[data-testid=foreign-file-row]` row + does NOT call openNote on click.
 *      A click instead surfaces a toast through useToastStore.
 *
 *   2. workspaceStore.openNote — calling openNote(id) on a foreign-kind note
 *      is a no-op (no new tab) AND posts a toast. This guards every entry
 *      point that ends up routed through openNote (search modal, command
 *      palette, keyboard Enter on the tree row, etc.).
 *
 *   3. Push plan — see foreignVaultFilesPush.test.ts for the syncToGitHub
 *      filter that drops foreign notes from the push.
 *
 * idb-keyval is mocked so the Zustand persist middleware doesn't reach
 * IndexedDB (jsdom doesn't have it).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react'
import { FolderTree } from '../components/sidebar/FolderTree'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useUIStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useToastStore } from '../stores/toastStore'
import type { Note } from '../types'

let noteCounter = 0
function makeNote(overrides: Partial<Note> = {}): Note {
  const id = `note-${++noteCounter}`
  const now = Date.now()
  return {
    id,
    title: `Note ${id}`,
    content: '',
    folderId: null,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    kind: 'markdown',
    ...overrides,
  }
}

function renderTreeWith(notes: Note[]) {
  useNoteStore.setState({ notes, selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  useUIStore.setState({ currentView: 'notes' })
  return render(<FolderTree onRightClick={() => {}} />)
}

beforeEach(() => {
  cleanup()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  // Toasts post real setTimeouts to auto-dismiss; previous-test timers
  // would fire mid-next-test otherwise. Reset the workspace too so a
  // previous-test tab doesn't leak across.
  useToastStore.setState({ toasts: [] })
  // Reset workspace to a single empty pane so per-test tab counts are
  // measured against a known baseline.
  const initialPaneId = 'test-pane'
  useWorkspaceStore.setState({
    panes: [{ id: initialPaneId, tabs: [], activeTabId: null }],
    layout: { kind: 'leaf', paneId: initialPaneId } as never,
    activePaneId: initialPaneId,
    histories: {},
    recents: [],
  })
})

afterAll(() => {
  cleanup()
})

describe('FolderTree — foreign vault file rows', () => {
  test('clicking a foreign row does NOT open a tab and DOES post an info toast', async () => {
    renderTreeWith([
      makeNote({ title: 'Untitled.canvas', kind: 'foreign', gitPath: 'Untitled.canvas' }),
    ])

    // Workspace starts with one empty pane, zero tabs.
    const before = useWorkspaceStore.getState().panes.reduce((n, p) => n + p.tabs.length, 0)

    const row = await screen.findByTestId('foreign-file-row')
    act(() => { fireEvent.click(row) })

    // No new tab opened — openNote was either bypassed entirely (FolderTree
    // routes foreign-row clicks straight to the toast) or refused by the
    // workspace guard. Either way: no tab.
    const after = useWorkspaceStore.getState().panes.reduce((n, p) => n + p.tabs.length, 0)
    expect(after).toBe(before)

    // And a toast was posted.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.length).toBeGreaterThan(0)
      expect(toasts.some(t => t.message.includes('cannot open Untitled.canvas'))).toBe(true)
    })
  })

  test('renders a foreign-kind note with the foreign-file row testid (not the markdown one)', async () => {
    renderTreeWith([
      makeNote({ title: 'Untitled.canvas', kind: 'foreign', gitPath: 'Untitled.canvas' }),
    ])

    const row = await screen.findByTestId('foreign-file-row')
    expect(row.getAttribute('data-foreign')).toBe('true')
    expect(row.textContent).toContain('Untitled.canvas')
    expect(row.getAttribute('title')).toBe('File type not supported yet')
    // The markdown leaf row uses `data-testid=note-row`; foreign rows MUST
    // NOT be tagged as such so click-to-open keyboard / mouse handlers in
    // tests can target only openable notes.
    expect(screen.queryByTestId('note-row')).toBeNull()
  })

  test('renders both a markdown note row AND a foreign row in the same tree', async () => {
    renderTreeWith([
      makeNote({ title: 'Real note', kind: 'markdown' }),
      makeNote({ title: 'Other.canvas', kind: 'foreign', gitPath: 'Other.canvas' }),
    ])

    // Wait for the foreign row to appear, then confirm both row testids are
    // present. We assert presence via queryByTestId !== null rather than
    // toBeInTheDocument — under React 19's concurrent rendering, a detached
    // DOM node can survive a beforeEach `cleanup()` and read back from
    // toBeInTheDocument as false, which is misleading here.
    await screen.findByTestId('foreign-file-row')
    expect(screen.queryByTestId('note-row')).not.toBeNull()
    expect(screen.queryByTestId('foreign-file-row')).not.toBeNull()
  })
})

describe('workspaceStore.openNote — foreign guard', () => {
  test('openNote on a foreign-kind note posts a toast and does not open a tab', async () => {
    const foreign = makeNote({ title: 'Untitled.canvas', kind: 'foreign', gitPath: 'Untitled.canvas' })
    useNoteStore.setState({ notes: [foreign], selectedNoteId: null })

    const tabsBefore = useWorkspaceStore.getState().panes.reduce((n, p) => n + p.tabs.length, 0)
    useWorkspaceStore.getState().openNote(foreign.id, { preview: false })
    const tabsAfter = useWorkspaceStore.getState().panes.reduce((n, p) => n + p.tabs.length, 0)

    expect(tabsAfter).toBe(tabsBefore)
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.length).toBeGreaterThan(0)
      expect(toasts.some(t => t.message.includes('Untitled.canvas'))).toBe(true)
    })
  })

  test('openNote on a markdown note still opens a tab normally (regression guard)', () => {
    const md = makeNote({ title: 'Real note', kind: 'markdown' })
    useNoteStore.setState({ notes: [md], selectedNoteId: null })
    const tabsBefore = useWorkspaceStore.getState().panes.reduce((n, p) => n + p.tabs.length, 0)
    useWorkspaceStore.getState().openNote(md.id, { preview: false })
    const tabsAfter = useWorkspaceStore.getState().panes.reduce((n, p) => n + p.tabs.length, 0)
    expect(tabsAfter).toBe(tabsBefore + 1)
  })
})
