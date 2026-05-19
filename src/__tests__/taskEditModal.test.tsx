/**
 * taskEditModal.test.tsx
 *
 * Render + behaviour test for the TaskEditModal. Verifies:
 *   - Fields populate from parseTaskMetadata on the targeted task line.
 *   - Editing a date + clicking Save writes the new content back via
 *     useNoteStore.updateNote with the canonical emoji syntax intact.
 *   - Cancel closes without mutating the note.
 *
 * idb-keyval is mocked so the Zustand persist middleware doesn't hit
 * IndexedDB (unavailable in jsdom).
 */

// ── idb-keyval mock (must come before any store import) ──────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TaskEditModal } from '../components/modals/TaskEditModal'
import { useUIStore } from '../stores/uiStore'
import { useNoteStore } from '../stores/noteStore'
import type { Note } from '@/types'

const TEST_NOTE_ID = 'note-task-1'

function makeNote(content: string): Note {
  return {
    id: TEST_NOTE_ID,
    title: 'Task host',
    content,
    folderId: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
  } as Note
}

function resetStores(noteContent: string) {
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
  useNoteStore.setState({
    notes: [makeNote(noteContent)],
    selectedNoteId: TEST_NOTE_ID,
  })
}

function openModalAtLine(line: number) {
  useUIStore.setState({
    modal: { type: 'task-edit', data: { noteId: TEST_NOTE_ID, line } },
  })
}

describe('TaskEditModal', () => {
  test('does not render when modal type is not task-edit', () => {
    resetStores('- [ ] hello')
    render(<TaskEditModal />)
    // Modal should NOT show any of its labels
    expect(screen.queryByLabelText('Task description')).not.toBeInTheDocument()
  })

  test('populates form fields from parseTaskMetadata when opened', () => {
    resetStores('- [ ] write report ⏫ 📅 2026-05-20 ⏳ 2026-05-19 🛫 2026-05-18')
    openModalAtLine(0)
    render(<TaskEditModal />)

    // Description text
    const desc = screen.getByLabelText('Task description') as HTMLInputElement
    expect(desc.value).toBe('write report')

    // Each date input populated
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2026-05-20')
    expect((screen.getByLabelText('Scheduled date') as HTMLInputElement).value).toBe('2026-05-19')
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-05-18')

    // Priority select
    expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('highest')

    // Open status: checkbox unchecked
    expect((screen.getByLabelText('Task done') as HTMLInputElement).checked).toBe(false)
  })

  test('closed task populates Done checkbox + ✅ date field', () => {
    resetStores('- [x] shipped ✅ 2026-05-21')
    openModalAtLine(0)
    render(<TaskEditModal />)

    expect((screen.getByLabelText('Task done') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Done date') as HTMLInputElement).value).toBe('2026-05-21')
  })

  test('changing due date and clicking Save updates the note content', async () => {
    const user = userEvent.setup()
    resetStores('- [ ] write report 📅 2026-05-20')
    openModalAtLine(0)
    render(<TaskEditModal />)

    const due = screen.getByLabelText('Due date') as HTMLInputElement
    // fireEvent.change is the canonical way to update a controlled date input
    // in jsdom — userEvent.type doesn't play nicely with native date inputs.
    fireEvent.change(due, { target: { value: '2026-06-01' } })

    await user.click(screen.getByRole('button', { name: /save/i }))

    const updated = useNoteStore.getState().getNoteById(TEST_NOTE_ID)
    expect(updated?.content).toBe('- [ ] write report 📅 2026-06-01')
    // Modal should be closed after save
    expect(useUIStore.getState().modal.type).toBeNull()
  })

  test('Save writes canonical marker order: priority, due, scheduled, start', async () => {
    const user = userEvent.setup()
    resetStores('- [ ] thing')
    openModalAtLine(0)
    render(<TaskEditModal />)

    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'highest' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-05-20' } })
    fireEvent.change(screen.getByLabelText('Scheduled date'), { target: { value: '2026-05-19' } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-05-18' } })

    await user.click(screen.getByRole('button', { name: /save/i }))

    const updated = useNoteStore.getState().getNoteById(TEST_NOTE_ID)
    expect(updated?.content).toBe('- [ ] thing ⏫ 📅 2026-05-20 ⏳ 2026-05-19 🛫 2026-05-18')
  })

  test('Cancel closes the modal without mutating the note', async () => {
    const user = userEvent.setup()
    const originalContent = '- [ ] untouched 📅 2026-05-20'
    resetStores(originalContent)
    openModalAtLine(0)
    render(<TaskEditModal />)

    // Edit the description but Cancel instead of Save
    const desc = screen.getByLabelText('Task description') as HTMLInputElement
    await user.clear(desc)
    await user.type(desc, 'edited but bailing')

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    const updated = useNoteStore.getState().getNoteById(TEST_NOTE_ID)
    expect(updated?.content).toBe(originalContent)
    expect(useUIStore.getState().modal.type).toBeNull()
  })

  test('Save preserves surrounding content when target line is in the middle', async () => {
    const user = userEvent.setup()
    resetStores('header\n- [ ] middle task 📅 2026-05-20\nfooter')
    openModalAtLine(1)
    render(<TaskEditModal />)

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-31' } })
    await user.click(screen.getByRole('button', { name: /save/i }))

    const updated = useNoteStore.getState().getNoteById(TEST_NOTE_ID)
    expect(updated?.content).toBe('header\n- [ ] middle task 📅 2026-12-31\nfooter')
  })

  test('clearing a date and saving strips the corresponding marker', async () => {
    const user = userEvent.setup()
    resetStores('- [ ] keep me 📅 2026-05-20 ⏳ 2026-05-19')
    openModalAtLine(0)
    render(<TaskEditModal />)

    // Click the clear button next to the due date
    const clearBtn = screen.getByLabelText('Clear Due date')
    await user.click(clearBtn)
    await user.click(screen.getByRole('button', { name: /save/i }))

    const updated = useNoteStore.getState().getNoteById(TEST_NOTE_ID)
    expect(updated?.content).toBe('- [ ] keep me ⏳ 2026-05-19')
    expect(updated?.content).not.toContain('📅')
  })

  test('marking an open task done + saving adds ✅ if completedDate provided', async () => {
    const user = userEvent.setup()
    resetStores('- [ ] finish it')
    openModalAtLine(0)
    render(<TaskEditModal />)

    // Tick the Done checkbox — that surfaces the Done date input
    await user.click(screen.getByLabelText('Task done'))
    const doneDateInput = screen.getByLabelText('Done date') as HTMLInputElement
    fireEvent.change(doneDateInput, { target: { value: '2026-05-21' } })

    await user.click(screen.getByRole('button', { name: /save/i }))

    const updated = useNoteStore.getState().getNoteById(TEST_NOTE_ID)
    expect(updated?.content).toBe('- [x] finish it ✅ 2026-05-21')
  })
})
