// Interaction tests for the right-sidebar Properties panel.
// Covers: empty state, title/tags/pin/path rendering, pin toggle.

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { PropertiesPanel } from '../components/sidebar/PropertiesPanel'
import { useNoteStore } from '../stores/noteStore'
import type { Note } from '../types'

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'My note',
    content: 'Body with #tag-one and #tag-two',
    folderId: null,
    createdAt: new Date('2026-05-01T10:00:00Z').getTime(),
    updatedAt: new Date('2026-05-22T14:30:00Z').getTime(),
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: null,
    gitLastPushedSha: null,
    ...overrides,
  }
}

function seedNote(note: Note) {
  useNoteStore.setState({ notes: [note], selectedNoteId: note.id })
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
})

describe('PropertiesPanel — empty state', () => {
  it('shows a placeholder when no note is selected', () => {
    render(<PropertiesPanel />)
    expect(screen.getByTestId('properties-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument()
  })
})

describe('PropertiesPanel — title', () => {
  it('renders the note title when set', () => {
    seedNote(makeNote({ title: 'Hello world' }))
    render(<PropertiesPanel />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders an "(untitled)" placeholder when title is empty', () => {
    seedNote(makeNote({ title: '' }))
    render(<PropertiesPanel />)
    expect(screen.getByText('(untitled)')).toBeInTheDocument()
  })
})

describe('PropertiesPanel — tags', () => {
  it('renders a chip per tag from #word patterns in content', () => {
    seedNote(makeNote({ content: 'Body with #alpha and #beta and #alpha again' }))
    render(<PropertiesPanel />)
    expect(screen.getByTestId('properties-tag-alpha')).toBeInTheDocument()
    expect(screen.getByTestId('properties-tag-beta')).toBeInTheDocument()
    // De-duped — alpha appears once.
    expect(screen.getAllByText('#alpha')).toHaveLength(1)
  })

  it('shows "No tags" when content has none', () => {
    seedNote(makeNote({ content: 'Plain body with no hashes' }))
    render(<PropertiesPanel />)
    expect(screen.getByText(/no tags/i)).toBeInTheDocument()
  })
})

describe('PropertiesPanel — pin toggle', () => {
  it('reflects the current pin state', () => {
    seedNote(makeNote({ isPinned: true }))
    render(<PropertiesPanel />)
    const btn = screen.getByTestId('properties-pin-toggle')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveTextContent(/click to unpin/i)
  })

  it('togglePinNote is called on click', () => {
    seedNote(makeNote({ isPinned: false }))
    render(<PropertiesPanel />)
    fireEvent.click(screen.getByTestId('properties-pin-toggle'))
    expect(useNoteStore.getState().notes[0].isPinned).toBe(true)
  })
})

describe('PropertiesPanel — gitPath', () => {
  it('renders the path when present', () => {
    seedNote(makeNote({ gitPath: 'notes/my-note.md' }))
    render(<PropertiesPanel />)
    expect(screen.getByTestId('properties-git-path')).toHaveTextContent('notes/my-note.md')
  })

  it('hides the row entirely when gitPath is null (note never pushed)', () => {
    seedNote(makeNote({ gitPath: null }))
    render(<PropertiesPanel />)
    expect(screen.queryByTestId('properties-git-path')).not.toBeInTheDocument()
  })
})

describe('PropertiesPanel — timestamps', () => {
  it('formats createdAt + updatedAt', () => {
    seedNote(makeNote())
    render(<PropertiesPanel />)
    // Locale-dependent output; assert non-empty + non-"—" rather than
    // chase a specific string. The "—" sentinel is only used when the
    // timestamp is 0 / null.
    const created = screen.getByTestId('properties-created').textContent ?? ''
    const updated = screen.getByTestId('properties-updated').textContent ?? ''
    expect(created.length).toBeGreaterThan(0)
    expect(created).not.toBe('—')
    expect(updated).not.toBe('—')
  })

  it('falls back to em-dash for missing timestamps', () => {
    seedNote(makeNote({ createdAt: 0, updatedAt: 0 }))
    render(<PropertiesPanel />)
    expect(screen.getByTestId('properties-created').textContent).toBe('—')
    expect(screen.getByTestId('properties-updated').textContent).toBe('—')
  })
})
