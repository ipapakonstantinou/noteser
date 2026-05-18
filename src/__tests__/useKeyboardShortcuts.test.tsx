/**
 * useKeyboardShortcuts.test.tsx
 *
 * Tests for the window-level keydown handler in useKeyboardShortcuts.
 * We mock idb-keyval so the Zustand persist middleware doesn't try to hit
 * IndexedDB (unavailable in jsdom).  All store state is injected / read via
 * getState() / setState() — the real store logic runs; only the storage
 * back-end is faked.
 */

// ── idb-keyval mock (must come before any store import) ──────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useUIStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Fire a synthetic keydown on window and return the event (so callers can
 *  inspect defaultPrevented after dispatch). */
function fireKey(
  key: string,
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  window.dispatchEvent(event)
  return event
}

// ── state reset helpers ───────────────────────────────────────────────────────
// We use the merge form of setState (no second `true` argument) so the action
// functions that Zustand stored alongside the data are preserved.

function resetNoteStore() {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
}

function resetFolderStore() {
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
}

function resetUIStore() {
  useUIStore.setState({
    sidebarCollapsed: false,
    sidebarWidth: 256,
    isSearchOpen: false,
    searchQuery: '',
    isPreviewMode: false,
    contextMenu: null,
    modal: { type: null },
    currentView: 'notes',
    renameRequest: null,
  })
}

function resetWorkspaceStore() {
  // Keep one empty pane — that is the valid initial shape the store starts with.
  const emptyPane = { id: 'test-pane', tabs: [], activeTabId: null }
  useWorkspaceStore.setState({ panes: [emptyPane], activePaneId: null, mergeAppliedCount: 0 })
}

// ── mount helper ──────────────────────────────────────────────────────────────

/** Mount the hook, which registers the window keydown listener. */
function mountHook() {
  return renderHook(() => useKeyboardShortcuts())
}

// =============================================================================
// Tests
// =============================================================================

beforeEach(() => {
  resetNoteStore()
  resetFolderStore()
  resetUIStore()
  resetWorkspaceStore()
})

// ── Alt+N — New note at root ──────────────────────────────────────────────────

describe('Alt+N — new note at root', () => {
  test('creates a new note in noteStore', () => {
    mountHook()
    act(() => { fireKey('n', { altKey: true }) })

    const { notes } = useNoteStore.getState()
    expect(notes).toHaveLength(1)
  })

  test('new note has folderId === null (always at root)', () => {
    mountHook()
    act(() => { fireKey('n', { altKey: true }) })

    const { notes } = useNoteStore.getState()
    expect(notes[0].folderId).toBeNull()
  })

  test('new note is opened in a workspace pane tab', () => {
    mountHook()
    act(() => { fireKey('n', { altKey: true }) })

    const { notes } = useNoteStore.getState()
    const noteId = notes[0].id

    const { panes } = useWorkspaceStore.getState()
    const allTabs = panes.flatMap(p => p.tabs)
    const noteTab = allTabs.find(t => t.kind === 'note' && t.noteId === noteId)
    expect(noteTab).toBeDefined()
  })

  test('does not open the tab as preview (preview: false)', () => {
    mountHook()
    act(() => { fireKey('n', { altKey: true }) })

    const { notes } = useNoteStore.getState()
    const noteId = notes[0].id
    const { panes } = useWorkspaceStore.getState()
    const allTabs = panes.flatMap(p => p.tabs)
    const noteTab = allTabs.find(t => t.kind === 'note' && t.noteId === noteId)
    expect(noteTab?.kind === 'note' && noteTab.isPreview).toBe(false)
  })

  test('event.preventDefault() is called', () => {
    mountHook()
    let event!: KeyboardEvent
    act(() => { event = fireKey('n', { altKey: true }) })
    expect(event.defaultPrevented).toBe(true)
  })

  test('folderId stays null even when an active folder is set', () => {
    // Set an active folder; toolbar buttons must still use root.
    useFolderStore.setState({ activeFolderId: 'some-folder-id' })
    mountHook()
    act(() => { fireKey('n', { altKey: true }) })

    const { notes } = useNoteStore.getState()
    expect(notes[0].folderId).toBeNull()
  })
})

// ── Ctrl+Shift+N — New folder at root ────────────────────────────────────────

describe('Ctrl+Shift+N — new folder at root', () => {
  test('creates a new folder in folderStore', () => {
    mountHook()
    act(() => { fireKey('n', { ctrlKey: true, shiftKey: true }) })

    const { folders } = useFolderStore.getState()
    expect(folders).toHaveLength(1)
  })

  test('new folder has parentId === null (always at root)', () => {
    mountHook()
    act(() => { fireKey('n', { ctrlKey: true, shiftKey: true }) })

    const { folders } = useFolderStore.getState()
    expect(folders[0].parentId).toBeNull()
  })

  test('parentId stays null even when activeFolderId is set', () => {
    useFolderStore.setState({ activeFolderId: 'some-folder-id' })
    mountHook()
    act(() => { fireKey('n', { ctrlKey: true, shiftKey: true }) })

    const { folders } = useFolderStore.getState()
    expect(folders[0].parentId).toBeNull()
  })

  test('event.preventDefault() is called', () => {
    mountHook()
    let event!: KeyboardEvent
    act(() => { event = fireKey('n', { ctrlKey: true, shiftKey: true }) })
    expect(event.defaultPrevented).toBe(true)
  })
})

// ── Ctrl+N alone — must NOT fire any handler ──────────────────────────────────

describe('Ctrl+N alone — browser-reserved, no handler', () => {
  test('note count is unchanged after Ctrl+N', () => {
    mountHook()
    act(() => { fireKey('n', { ctrlKey: true }) })

    const { notes } = useNoteStore.getState()
    expect(notes).toHaveLength(0)
  })

  test('event.defaultPrevented is false — browser keeps control', () => {
    mountHook()
    let event!: KeyboardEvent
    act(() => { event = fireKey('n', { ctrlKey: true }) })
    expect(event.defaultPrevented).toBe(false)
  })

  test('folder count is also unchanged after Ctrl+N', () => {
    mountHook()
    act(() => { fireKey('n', { ctrlKey: true }) })

    const { folders } = useFolderStore.getState()
    expect(folders).toHaveLength(0)
  })
})

// ── Smoke tests for existing shortcuts ───────────────────────────────────────

describe('Ctrl+K — open search', () => {
  test('sets isSearchOpen to true', () => {
    mountHook()
    act(() => { fireKey('k', { ctrlKey: true }) })
    expect(useUIStore.getState().isSearchOpen).toBe(true)
  })

  test('event.defaultPrevented is true', () => {
    mountHook()
    let event!: KeyboardEvent
    act(() => { event = fireKey('k', { ctrlKey: true }) })
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('Ctrl+B — toggle sidebar', () => {
  test('flips sidebarCollapsed from false to true', () => {
    useUIStore.setState({ sidebarCollapsed: false })
    mountHook()
    act(() => { fireKey('b', { ctrlKey: true }) })
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
  })

  test('flips sidebarCollapsed from true to false', () => {
    useUIStore.setState({ sidebarCollapsed: true })
    mountHook()
    act(() => { fireKey('b', { ctrlKey: true }) })
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })

  test('event.defaultPrevented is true', () => {
    mountHook()
    let event!: KeyboardEvent
    act(() => { event = fireKey('b', { ctrlKey: true }) })
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('Ctrl+/ — open shortcuts modal', () => {
  test('sets modal.type to "shortcuts"', () => {
    mountHook()
    act(() => { fireKey('/', { ctrlKey: true }) })
    expect(useUIStore.getState().modal.type).toBe('shortcuts')
  })

  test('event.defaultPrevented is true', () => {
    mountHook()
    let event!: KeyboardEvent
    act(() => { event = fireKey('/', { ctrlKey: true }) })
    expect(event.defaultPrevented).toBe(true)
  })
})
