/**
 * contextMenuGistVisibility.test.tsx
 *
 * Tests for the "Publish as gist" entry in ContextMenu:
 *   - Hidden when useGitHubStore.token is null.
 *   - Hidden when the right-clicked note is trashed (isDeleted: true).
 *   - Visible + functional when token is set and note is active.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ContextMenu } from '../components/sidebar/ContextMenu'
import { useNoteStore } from '../stores/noteStore'
import { useGitHubStore } from '../stores/githubStore'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { ContextMenuState } from '@/types'

// ── fixtures ──────────────────────────────────────────────────────────────────

const NOTE_ID = 'ctx-note-1'

function seedNote(overrides: Partial<{ isDeleted: boolean; gitPath: string }> = {}) {
  useNoteStore.setState({
    notes: [
      {
        id: NOTE_ID,
        title: 'Test Note',
        content: 'content',
        folderId: null,
        createdAt: 1000,
        updatedAt: 1000,
        isDeleted: overrides.isDeleted ?? false,
        deletedAt: overrides.isDeleted ? 1000 : null,
        isPinned: false,
        templateId: null,
        gitPath: overrides.gitPath ?? null,
      },
    ],
    selectedNoteId: null,
  })
}

const contextMenuState: NonNullable<ContextMenuState> = {
  type: 'note',
  id: NOTE_ID,
  x: 100,
  y: 100,
}

function renderMenu(onClose = jest.fn()) {
  return render(
    <ContextMenu contextMenu={contextMenuState} onClose={onClose} />
  )
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useGitHubStore.setState({ token: null, user: null, host: 'github' })
  useUIStore.setState({ modal: { type: null } })
  useSettingsStore.setState({ aiProvider: 'off' })
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ContextMenu — "Publish as gist" visibility', () => {
  test('is NOT rendered when GitHub token is null', () => {
    seedNote()
    // token defaults to null from beforeEach
    renderMenu()
    expect(screen.queryByText('Publish as gist')).not.toBeInTheDocument()
  })

  test('is NOT rendered when the note is trashed (isDeleted: true)', () => {
    seedNote({ isDeleted: true })
    useGitHubStore.setState({ token: 'ghp_tok', user: null })
    renderMenu()
    expect(screen.queryByText('Publish as gist')).not.toBeInTheDocument()
  })

  test('IS rendered when token is set and note is active', () => {
    seedNote()
    useGitHubStore.setState({ token: 'ghp_tok', user: null })
    renderMenu()
    expect(screen.getByText('Publish as gist')).toBeInTheDocument()
  })

  test('clicking "Publish as gist" calls openModal with publish-gist type and noteId', async () => {
    const user = userEvent.setup()
    seedNote()
    useGitHubStore.setState({ token: 'ghp_tok', user: null })
    const onClose = jest.fn()
    renderMenu(onClose)

    await user.click(screen.getByText('Publish as gist'))

    const modal = useUIStore.getState().modal
    expect(modal.type).toBe('publish-gist')
    expect((modal.data as { noteId: string }).noteId).toBe(NOTE_ID)
    expect(onClose).toHaveBeenCalled()
  })

  test('is NOT rendered when host is not GitHub', () => {
    seedNote()
    useGitHubStore.setState({ token: 'ghp_tok', user: null, host: 'forgejo' })
    renderMenu()
    expect(screen.queryByText('Publish as gist')).not.toBeInTheDocument()
  })
})

describe('ContextMenu — "View history" visibility', () => {
  test('IS rendered when the note has a gitPath and host is GitHub', () => {
    seedNote({ gitPath: 'notes/test.md' })
    useGitHubStore.setState({ token: 'ghp_tok', user: null, host: 'github' })
    renderMenu()
    expect(screen.getByText('View history')).toBeInTheDocument()
  })

  test('is NOT rendered when host is not GitHub', () => {
    seedNote({ gitPath: 'notes/test.md' })
    useGitHubStore.setState({ token: 'ghp_tok', user: null, host: 'forgejo' })
    renderMenu()
    expect(screen.queryByText('View history')).not.toBeInTheDocument()
  })
})
