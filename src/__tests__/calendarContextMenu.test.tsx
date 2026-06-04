/**
 * calendarContextMenu.test.tsx
 *
 * Right-click context menu on a calendar day cell (added 2026-06-04 per
 * user feedback — Telegram message: he wants to right-click a day and
 * delete the daily note). The menu has two shapes:
 *
 *   • Day HAS a daily note → Open / Open in new pane / Copy wikilink /
 *                            Add to bookmarks / Delete daily note
 *   • Day has NO note yet  → Create daily note (discoverability)
 *
 * Delete respects the new `confirmBeforeTrash` settings flag — when
 * false (and trashMode is the default 'trash'), Delete bypasses the
 * DeleteConfirmModal and routes straight to noteStore.deleteNote.
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
import { render, screen, fireEvent, act } from '@testing-library/react'

import { CalendarView } from '../components/sidebar/CalendarView'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { formatDate } from '../utils/dateFormat'

// Mock useHydration so the calendar treats notes as available
// immediately — otherwise the day cells render but the notedDays set
// stays empty and "has a daily note" branches won't trigger.
jest.mock('../hooks', () => ({
  useHydration: () => true,
}))

const today = new Date()
// Pick a target day in the CURRENT month so the cell is rendered (the
// view defaults to the current month). Day 15 is always in-range; if
// today is exactly the 15th, fall back to the 14th so the assertions
// that distinguish "today" vs "the target day" don't collide.
const targetDay = today.getDate() === 15 ? 14 : 15
const targetDate = new Date(today.getFullYear(), today.getMonth(), targetDay)
const targetTitle = formatDate(targetDate, 'YYYY-MM-DD')
const testId = `calendar-day-${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`

function seedDailyFolder() {
  // Materialise the Notes/Daily folder hierarchy so the lookup that
  // findDailyNoteId does (ensureFolderPath → activeNotes.find) matches.
  const parent = useFolderStore.getState().addFolder({ name: 'Notes' })
  const child = useFolderStore.getState().addFolder({ name: 'Daily', parentId: parent.id })
  return child.id
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {}, deletedFolderPaths: [] })
  useSettingsStore.setState({
    dailyNotesFolder: 'Notes/Daily',
    dailyNoteDateFormat: 'YYYY-MM-DD',
    dailyNoteTemplateId: null,
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

describe('Calendar right-click menu', () => {
  test('day WITH a daily note shows the note-action set (incl. Delete daily note)', () => {
    const folderId = seedDailyFolder()
    useNoteStore.getState().addNote({
      title: targetTitle,
      folderId,
      content: 'hello',
    })

    render(<CalendarView />)
    fireEvent.contextMenu(screen.getByTestId(testId))

    expect(screen.getByTestId('calendar-day-context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-day-context-open')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-day-context-split')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-day-context-copy-wikilink')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-day-context-bookmark')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-day-context-delete')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-day-context-create')).not.toBeInTheDocument()
  })

  test('day WITHOUT a daily note shows "Create daily note" instead', () => {
    // No note seeded — the target day is blank.
    render(<CalendarView />)
    fireEvent.contextMenu(screen.getByTestId(testId))

    expect(screen.getByTestId('calendar-day-context-create')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-day-context-delete')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-day-context-open')).not.toBeInTheDocument()
  })

  test('Delete with confirmBeforeTrash=true opens the DeleteConfirmModal', () => {
    const folderId = seedDailyFolder()
    const note = useNoteStore.getState().addNote({
      title: targetTitle,
      folderId,
      content: '',
    })
    useSettingsStore.setState({ confirmBeforeTrash: true, trashMode: 'trash' })

    render(<CalendarView />)
    fireEvent.contextMenu(screen.getByTestId(testId))
    fireEvent.click(screen.getByTestId('calendar-day-context-delete'))

    const modal = useUIStore.getState().modal
    expect(modal.type).toBe('delete')
    expect(modal.data).toEqual({ type: 'note', id: note.id })
    // Note still alive — the modal hasn't been confirmed yet.
    expect(useNoteStore.getState().notes.find(n => n.id === note.id)?.isDeleted)
      .toBeFalsy()
  })

  test('Delete with confirmBeforeTrash=false skips the modal and soft-deletes the note', () => {
    const folderId = seedDailyFolder()
    const note = useNoteStore.getState().addNote({
      title: targetTitle,
      folderId,
      content: '',
    })
    useSettingsStore.setState({ confirmBeforeTrash: false, trashMode: 'trash' })

    render(<CalendarView />)
    fireEvent.contextMenu(screen.getByTestId(testId))
    fireEvent.click(screen.getByTestId('calendar-day-context-delete'))

    // Modal never opened; note went straight to the trash.
    expect(useUIStore.getState().modal.type).not.toBe('delete')
    const after = useNoteStore.getState().notes.find(n => n.id === note.id)
    expect(after?.isDeleted).toBe(true)
  })

  test('Delete with hardDelete trashMode ALWAYS confirms even with confirmBeforeTrash=false', () => {
    // hardDelete is irreversible — bypassing the confirm would be a
    // foot-gun no toggle should expose. Regression guard.
    const folderId = seedDailyFolder()
    const note = useNoteStore.getState().addNote({
      title: targetTitle,
      folderId,
      content: '',
    })
    useSettingsStore.setState({ confirmBeforeTrash: false, trashMode: 'hardDelete' })

    render(<CalendarView />)
    fireEvent.contextMenu(screen.getByTestId(testId))
    fireEvent.click(screen.getByTestId('calendar-day-context-delete'))

    expect(useUIStore.getState().modal.type).toBe('delete')
    // Note still exists (not yet hard-deleted; modal not confirmed).
    expect(useNoteStore.getState().notes.find(n => n.id === note.id)).toBeDefined()
  })

  test('Create daily note action creates the note', () => {
    render(<CalendarView />)
    fireEvent.contextMenu(screen.getByTestId(testId))
    act(() => {
      fireEvent.click(screen.getByTestId('calendar-day-context-create'))
    })

    const created = useNoteStore.getState().notes.find(n => n.title === targetTitle)
    expect(created).toBeDefined()
  })

  test('Copy wikilink writes [[<title>]] to the clipboard', () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const folderId = seedDailyFolder()
    useNoteStore.getState().addNote({ title: targetTitle, folderId, content: '' })

    render(<CalendarView />)
    fireEvent.contextMenu(screen.getByTestId(testId))
    fireEvent.click(screen.getByTestId('calendar-day-context-copy-wikilink'))

    expect(writeText).toHaveBeenCalledWith(`[[${targetTitle}]]`)
  })
})
