/**
 * folderTreeLoadingBanner.test.tsx
 *
 * Regression coverage for the "N notes loading…" banner (#30). On a first
 * clone, note bodies stream in progressively: titles show immediately while
 * bodies arrive in the background. While any note is still a shell
 * (contentLoaded === false), FolderTree shows a subtle banner counting the
 * shells. This locks the behaviour in so it can't silently regress again.
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
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { FolderTree } from '../components/sidebar/FolderTree'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useUIStore } from '../stores/uiStore'
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
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
})

describe('FolderTree — "N notes loading…" banner', () => {
  test('shows the banner with the shell count when notes are still loading', async () => {
    renderTreeWith([
      makeNote({ contentLoaded: false }),
      makeNote({ contentLoaded: false }),
      makeNote({ contentLoaded: true }),
    ])

    const banner = await screen.findByTestId('shell-loading-banner')
    expect(banner).toBeInTheDocument()
    // Two of the three notes are shells.
    expect(banner).toHaveTextContent('2 notes loading…')
  })

  test('hides the banner when every note has loaded', async () => {
    renderTreeWith([
      makeNote({ contentLoaded: true }),
      makeNote({}), // undefined === treated as loaded
    ])

    // Wait for hydration to flush, then assert the banner is absent.
    await waitFor(() => {
      expect(screen.queryByTestId('shell-loading-banner')).not.toBeInTheDocument()
    })
  })

  test('hides the banner for an empty vault', async () => {
    renderTreeWith([])

    await waitFor(() => {
      expect(screen.queryByTestId('shell-loading-banner')).not.toBeInTheDocument()
    })
  })
})
