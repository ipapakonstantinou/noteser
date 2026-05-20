/**
 * periodicNotes.test.ts
 *
 * Verifies weekly + monthly note utilities create + reuse notes in
 * the configured periodic-notes folders.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { openThisWeekNote, openThisMonthNote } from '../utils/periodicNotes'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  useSettingsStore.setState({
    weeklyNotesFolder: 'Notes/Weekly',
    weeklyNoteDateFormat: 'YYYY-WW',
    monthlyNotesFolder: 'Notes/Monthly',
    monthlyNoteDateFormat: 'YYYY-MM',
  })
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: null,
    mergeAppliedCount: 0,
  })
})

describe('openThisWeekNote', () => {
  test('creates a new weekly note in the configured folder hierarchy', () => {
    // 2026-05-19 is a Tuesday — ISO week 21.
    openThisWeekNote(new Date(2026, 4, 19))
    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('2026-21')
    // Materialised hierarchy: Notes (parent) / Weekly (child)
    const folders = useFolderStore.getState().folders
    const parent = folders.find(f => f.name === 'Notes' && f.parentId == null)
    const child = folders.find(f => f.name === 'Weekly' && f.parentId === parent?.id)
    expect(child).toBeDefined()
    expect(notes[0].folderId).toBe(child!.id)
  })

  test('reuses an existing weekly note for the same week', () => {
    const a = openThisWeekNote(new Date(2026, 4, 19))
    const b = openThisWeekNote(new Date(2026, 4, 22))   // same ISO week
    expect(a).toBe(b)
    expect(useNoteStore.getState().notes).toHaveLength(1)
  })
})

describe('openThisMonthNote', () => {
  test('creates a new monthly note with YYYY-MM title', () => {
    openThisMonthNote(new Date(2026, 4, 19))
    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('2026-05')
  })

  test('reuses an existing monthly note for the same calendar month', () => {
    const a = openThisMonthNote(new Date(2026, 4, 1))
    const b = openThisMonthNote(new Date(2026, 4, 31))
    expect(a).toBe(b)
    expect(useNoteStore.getState().notes).toHaveLength(1)
  })
})
