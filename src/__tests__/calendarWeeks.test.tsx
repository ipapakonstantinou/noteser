/**
 * calendarWeeks.test.tsx
 *
 * Calendar W-column + weekly notes (Feature B on the fetch-timeouts
 * branch, 2026-06-04):
 *
 *   - The W column renders to the LEFT of the day-of-week headers
 *     with one cell per calendar row showing the ISO week number.
 *   - Clicking a W cell creates the weekly note in the configured
 *     folder + format.
 *   - Clicking the same W cell again OPENS the existing note (no
 *     duplicate).
 *   - Right-click on a W cell opens the same context menu shape as a
 *     day cell, with labels reading "weekly note" in week mode.
 *
 * idb-keyval is mocked so Zustand persist doesn't hit IndexedDB
 * (unavailable in jsdom).
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

import { CalendarView } from '../components/sidebar/CalendarView'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

jest.mock('../hooks', () => ({
  useHydration: () => true,
}))

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({
    folders: [],
    activeFolderId: null,
    expandedFolders: {},
    deletedFolderPaths: [],
  })
  useSettingsStore.setState({
    dailyNotesFolder: 'Notes/Daily',
    dailyNoteDateFormat: 'YYYY-MM-DD',
    dailyNoteTemplateId: null,
    weeklyNotesFolder: 'Notes/Weekly',
    weeklyNoteDateFormat: 'YYYY-WW',
    weeklyNoteTemplateId: null,
    calendarWeekStartDay: 1,
    confirmBeforeTrash: true,
    trashMode: 'trash',
  })
  useUIStore.setState({ modal: { type: null } })
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
  })
})

describe('Calendar W column', () => {
  test('renders a W header cell + at least 4 ISO week-number cells', () => {
    render(<CalendarView />)
    // The header. We look it up by text rather than testid because
    // the header is a div, not a button.
    expect(screen.getByLabelText('ISO week number')).toBeInTheDocument()
    // Every visible month has at least 4 calendar rows → at least 4
    // W cells.
    const weekButtons = screen.getAllByLabelText(/Open weekly note for week/i)
    expect(weekButtons.length).toBeGreaterThanOrEqual(4)
  })
})

describe('W cell click — open / create weekly note', () => {
  test('first click creates the weekly note in the configured folder', () => {
    render(<CalendarView />)
    const weekButtons = screen.getAllByLabelText(/Open weekly note for week/i)
    expect(weekButtons.length).toBeGreaterThan(0)
    fireEvent.click(weekButtons[0])

    const notes = useNoteStore.getState().notes
    expect(notes.length).toBe(1)
    // The note title matches the YYYY-WW format.
    expect(notes[0].title).toMatch(/^\d{4}-\d{2}$/)
    // It lives under Notes/Weekly — i.e. the folderId chain reaches a
    // folder named "Weekly" with parent "Notes".
    const folder = useFolderStore.getState().folders.find(f => f.id === notes[0].folderId)
    expect(folder?.name).toBe('Weekly')
    const parent = useFolderStore.getState().folders.find(f => f.id === folder?.parentId)
    expect(parent?.name).toBe('Notes')
  })

  test('second click on the same week OPENS the existing note (no duplicate)', () => {
    render(<CalendarView />)
    const weekButtons = screen.getAllByLabelText(/Open weekly note for week/i)
    fireEvent.click(weekButtons[0])
    fireEvent.click(weekButtons[0])
    expect(useNoteStore.getState().notes).toHaveLength(1)
  })

  test('weekly-note template seeds the new note body', () => {
    // Pre-seed a template note and point the setting at it.
    const templateNote = useNoteStore.getState().addNote({
      title: 'Weekly Template',
      folderId: null,
      content: '## TODO\n- weekly review',
    })
    useSettingsStore.setState({ weeklyNoteTemplateId: templateNote.id })

    render(<CalendarView />)
    const weekButtons = screen.getAllByLabelText(/Open weekly note for week/i)
    fireEvent.click(weekButtons[0])

    // The created note's content should match the template.
    const created = useNoteStore.getState().notes.find(
      n => n.id !== templateNote.id && !n.isDeleted,
    )
    expect(created?.content).toBe('## TODO\n- weekly review')
  })
})

describe('W cell right-click — weekly context menu', () => {
  test('shows "Create weekly note" when no weekly note exists yet', () => {
    render(<CalendarView />)
    const weekButtons = screen.getAllByLabelText(/Open weekly note for week/i)
    fireEvent.contextMenu(weekButtons[0])

    const create = screen.getByTestId('calendar-day-context-create')
    // The label should say "weekly note" (not "daily note").
    expect(create.textContent).toMatch(/weekly note/i)
  })

  test('shows "Delete weekly note" when a weekly note exists', () => {
    render(<CalendarView />)
    const weekButtons = screen.getAllByLabelText(/Open weekly note for week/i)
    // Create first.
    fireEvent.click(weekButtons[0])
    // Then right-click.
    fireEvent.contextMenu(weekButtons[0])

    const del = screen.getByTestId('calendar-day-context-delete')
    expect(del.textContent).toMatch(/delete weekly note/i)
  })

  test('delete via context menu (confirmBeforeTrash=false) soft-deletes the weekly note', () => {
    useSettingsStore.setState({ confirmBeforeTrash: false, trashMode: 'trash' })
    render(<CalendarView />)
    const weekButtons = screen.getAllByLabelText(/Open weekly note for week/i)
    fireEvent.click(weekButtons[0])
    fireEvent.contextMenu(weekButtons[0])
    fireEvent.click(screen.getByTestId('calendar-day-context-delete'))

    const notes = useNoteStore.getState().notes
    expect(notes[0].isDeleted).toBe(true)
  })
})
