/**
 * commands.test.ts
 *
 * Tests for the command-palette command registry in `src/utils/commands.ts`.
 * We mock idb-keyval so the noteStore's persist middleware doesn't try to
 * touch IndexedDB.
 */

// ── idb-keyval mock (must come before any store import) ──────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { getAllCommands, MAX_NOTE_COMMANDS, type Command } from '../utils/commands'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useUIStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useGitHubStore } from '../stores/githubStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SHORTCUTS } from '../utils/shortcuts'
import type { Note } from '../types'

// ── helpers ──────────────────────────────────────────────────────────────────

function resetAllStores() {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
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
  useWorkspaceStore.setState({
    panes: [{ id: 'test-pane', tabs: [], activeTabId: null }],
    activePaneId: 'test-pane',
    mergeAppliedCount: 0,
  })
  useGitHubStore.setState({
    token: null,
    user: null,
    connectedAt: null,
    syncRepo: null,
    lastSyncedAt: null,
    lastCommitSha: null,
    repoSyncStates: {},
    isSyncing: false,
  })
  useSettingsStore.getState().reset()
}

function makeNote(over: Partial<Note> = {}): Note {
  const now = Date.now()
  return {
    id: over.id ?? `n-${Math.random().toString(36).slice(2)}`,
    title: over.title ?? 'Untitled',
    content: over.content ?? '',
    folderId: over.folderId ?? null,
    createdAt: over.createdAt ?? now,
    updatedAt: over.updatedAt ?? now,
    isDeleted: over.isDeleted ?? false,
    deletedAt: over.deletedAt ?? null,
    isPinned: over.isPinned ?? false,
    templateId: over.templateId ?? null,
  }
}

function findCommand(cmds: Command[], id: string): Command | undefined {
  return cmds.find(c => c.id === id)
}

beforeEach(() => {
  resetAllStores()
})

// ── Baseline sanity ──────────────────────────────────────────────────────────

describe('getAllCommands — baseline', () => {
  test('returns a non-empty list when nothing is configured', () => {
    const cmds = getAllCommands()
    expect(cmds.length).toBeGreaterThan(0)
  })

  test('every command has a unique id', () => {
    const cmds = getAllCommands()
    const ids = cmds.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every command has a non-empty label and a run() function', () => {
    const cmds = getAllCommands()
    for (const c of cmds) {
      expect(typeof c.label).toBe('string')
      expect(c.label.length).toBeGreaterThan(0)
      expect(typeof c.run).toBe('function')
    }
  })
})

// ── SHORTCUTS coverage ──────────────────────────────────────────────────────

describe('getAllCommands — SHORTCUTS coverage', () => {
  test('includes every SHORTCUTS entry by id (prefixed with "shortcut.")', () => {
    const cmds = getAllCommands()
    for (const def of SHORTCUTS) {
      const cmd = findCommand(cmds, `shortcut.${def.id}`)
      expect(cmd).toBeDefined()
      expect(cmd?.label).toBe(def.label)
    }
  })

  test('the openCommandPalette shortcut shows its current combo', () => {
    const cmds = getAllCommands()
    const cmd = findCommand(cmds, 'shortcut.openCommandPalette')
    expect(cmd).toBeDefined()
    expect(cmd?.combo).toBe('Ctrl+Shift+P')
  })

  test('a shortcut override is reflected in the displayed combo', () => {
    useSettingsStore.getState().setShortcutOverride('openSearch', 'Ctrl+Alt+F')
    const cmds = getAllCommands()
    const cmd = findCommand(cmds, 'shortcut.openSearch')
    expect(cmd?.combo).toBe('Ctrl+Alt+F')
  })

  test('running shortcut.newNote actually creates a note', () => {
    const cmds = getAllCommands()
    const cmd = findCommand(cmds, 'shortcut.newNote')
    expect(cmd).toBeDefined()
    cmd!.run()
    expect(useNoteStore.getState().notes.length).toBe(1)
  })

  test('running shortcut.openSearch opens the search modal', () => {
    const cmds = getAllCommands()
    const cmd = findCommand(cmds, 'shortcut.openSearch')
    cmd!.run()
    expect(useUIStore.getState().isSearchOpen).toBe(true)
  })

  test('running shortcut.toggleSidebar flips the sidebar state', () => {
    useUIStore.setState({ sidebarCollapsed: false })
    const cmds = getAllCommands()
    const cmd = findCommand(cmds, 'shortcut.toggleSidebar')
    cmd!.run()
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
  })
})

// ── GitHub state-driven commands ────────────────────────────────────────────

describe('getAllCommands — GitHub connection', () => {
  test('when disconnected: shows "Connect to GitHub", hides Sync now / Disconnect', () => {
    // ensure disconnected (default)
    const cmds = getAllCommands()
    expect(findCommand(cmds, 'github.connect')).toBeDefined()
    expect(findCommand(cmds, 'github.sync')).toBeUndefined()
    expect(findCommand(cmds, 'github.disconnect')).toBeUndefined()
  })

  test('when connected: shows "Sync now" + "Disconnect", hides Connect', () => {
    useGitHubStore.setState({
      token: 'fake-token',
      user: { id: 1, login: 'u', name: 'U', avatar_url: 'x' },
      connectedAt: Date.now(),
    })
    const cmds = getAllCommands()
    expect(findCommand(cmds, 'github.connect')).toBeUndefined()
    expect(findCommand(cmds, 'github.sync')).toBeDefined()
    expect(findCommand(cmds, 'github.disconnect')).toBeDefined()
  })

  test('Connect command opens the github-auth modal', () => {
    const cmds = getAllCommands()
    const cmd = findCommand(cmds, 'github.connect')
    cmd!.run()
    expect(useUIStore.getState().modal.type).toBe('github-auth')
  })

  test('Disconnect command clears the token', () => {
    useGitHubStore.setState({
      token: 'fake-token',
      user: { id: 1, login: 'u', name: 'U', avatar_url: 'x' },
      connectedAt: Date.now(),
    })
    const cmds = getAllCommands()
    findCommand(cmds, 'github.disconnect')!.run()
    expect(useGitHubStore.getState().token).toBeNull()
  })
})

// ── Notes as commands ───────────────────────────────────────────────────────

describe('getAllCommands — notes', () => {
  test('lists each active note as an "Open: <title>" command', () => {
    const a = makeNote({ id: 'a', title: 'Alpha', updatedAt: 2 })
    const b = makeNote({ id: 'b', title: 'Bravo', updatedAt: 1 })
    useNoteStore.setState({ notes: [a, b], selectedNoteId: null })

    const cmds = getAllCommands()
    expect(findCommand(cmds, 'note.a')?.label).toBe('Open: Alpha')
    expect(findCommand(cmds, 'note.b')?.label).toBe('Open: Bravo')
  })

  test('excludes soft-deleted notes', () => {
    const a = makeNote({ id: 'a', title: 'Alpha', isDeleted: false })
    const b = makeNote({ id: 'b', title: 'Bravo', isDeleted: true, deletedAt: Date.now() })
    useNoteStore.setState({ notes: [a, b], selectedNoteId: null })

    const cmds = getAllCommands()
    expect(findCommand(cmds, 'note.a')).toBeDefined()
    expect(findCommand(cmds, 'note.b')).toBeUndefined()
  })

  test('two notes with identical titles both appear (de-duped by id, not by label)', () => {
    const a = makeNote({ id: 'a', title: 'Today' })
    const b = makeNote({ id: 'b', title: 'Today' })
    useNoteStore.setState({ notes: [a, b], selectedNoteId: null })

    const cmds = getAllCommands()
    const noteCommands = cmds.filter(c => c.id.startsWith('note.'))
    expect(noteCommands).toHaveLength(2)
    expect(noteCommands.map(c => c.id).sort()).toEqual(['note.a', 'note.b'])
  })

  test('untitled notes fall back to "Untitled Note"', () => {
    const a = makeNote({ id: 'a', title: '' })
    useNoteStore.setState({ notes: [a], selectedNoteId: null })

    const cmds = getAllCommands()
    expect(findCommand(cmds, 'note.a')?.label).toBe('Open: Untitled Note')
  })

  test('caps the note list at MAX_NOTE_COMMANDS', () => {
    const many: Note[] = Array.from({ length: MAX_NOTE_COMMANDS + 25 }, (_, i) =>
      makeNote({ id: `n${i}`, title: `Note ${i}`, updatedAt: i }),
    )
    useNoteStore.setState({ notes: many, selectedNoteId: null })

    const cmds = getAllCommands()
    const noteCommands = cmds.filter(c => c.id.startsWith('note.'))
    expect(noteCommands).toHaveLength(MAX_NOTE_COMMANDS)
  })

  test('running an "Open: <title>" command opens it in a workspace tab', () => {
    const a = makeNote({ id: 'a', title: 'Alpha' })
    useNoteStore.setState({ notes: [a], selectedNoteId: null })

    const cmds = getAllCommands()
    findCommand(cmds, 'note.a')!.run()

    const tabs = useWorkspaceStore.getState().panes.flatMap(p => p.tabs)
    expect(
      tabs.some(t => t.kind === 'note' && t.noteId === 'a'),
    ).toBe(true)
  })
})

// ── Hand-coded extras ───────────────────────────────────────────────────────

describe('getAllCommands — hand-coded extras', () => {
  test('Open Settings command opens the settings modal', () => {
    const cmds = getAllCommands()
    findCommand(cmds, 'app.openSettings')!.run()
    expect(useUIStore.getState().modal.type).toBe('settings')
  })

  test('Open shortcuts modal command opens the shortcuts modal', () => {
    const cmds = getAllCommands()
    findCommand(cmds, 'app.openShortcutsModal')!.run()
    expect(useUIStore.getState().modal.type).toBe('shortcuts')
  })

  test('Export command opens the export modal', () => {
    const cmds = getAllCommands()
    findCommand(cmds, 'app.openExport')!.run()
    expect(useUIStore.getState().modal.type).toBe('export')
  })

  test('Reset all settings command restores defaults', () => {
    useSettingsStore.getState().setShortcutOverride('openSearch', 'Ctrl+Alt+F')
    expect(useSettingsStore.getState().shortcutOverrides.openSearch).toBe('Ctrl+Alt+F')

    const cmds = getAllCommands()
    findCommand(cmds, 'app.resetSettings')!.run()
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({})
  })

  test('Toggle preview command flips preview mode', () => {
    expect(useUIStore.getState().isPreviewMode).toBe(false)
    const cmds = getAllCommands()
    findCommand(cmds, 'app.togglePreview')!.run()
    expect(useUIStore.getState().isPreviewMode).toBe(true)
  })
})

// ── Groups ───────────────────────────────────────────────────────────────────

describe('getAllCommands — grouping', () => {
  test('app and shortcut commands belong to the "Commands" group, notes to "Notes"', () => {
    const a = makeNote({ id: 'a', title: 'Alpha' })
    useNoteStore.setState({ notes: [a], selectedNoteId: null })

    const cmds = getAllCommands()
    expect(findCommand(cmds, 'shortcut.newNote')?.group).toBe('Commands')
    expect(findCommand(cmds, 'app.openSettings')?.group).toBe('Commands')
    expect(findCommand(cmds, 'note.a')?.group).toBe('Notes')
  })
})
