/**
 * a11yRoles.test.tsx
 *
 * Locks in the ARIA semantics added for issue #78. None of these
 * tests assert visual styling — they assert that the tree, tab
 * strips, and modal carry the correct roles + attributes screen
 * readers depend on.
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
import { render, screen, waitFor, act } from '@testing-library/react'
import { FolderTree } from '../components/sidebar/FolderTree'
import { Modal } from '../components/ui/Modal'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useUIStore } from '../stores/uiStore'
import type { Note, Folder } from '../types'

let counter = 0
function makeNote(overrides: Partial<Note> = {}): Note {
  const id = `note-${++counter}`
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

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  const id = `folder-${++counter}`
  const now = Date.now()
  return {
    id,
    name: `Folder ${id}`,
    parentId: null,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    deletedAt: null,
    order: 0,
    ...overrides,
  }
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  useUIStore.setState({ currentView: 'notes' })
})

describe('FolderTree — ARIA roles', () => {
  test('container is role="tree" and rows are role="treeitem"', async () => {
    const f1 = makeFolder()
    const n1 = makeNote({ folderId: null })
    useNoteStore.setState({ notes: [n1], selectedNoteId: null })
    useFolderStore.setState({ folders: [f1], activeFolderId: null, expandedFolders: {} })

    render(<FolderTree onRightClick={() => {}} />)

    await waitFor(() => {
      expect(screen.getByRole('tree')).toBeInTheDocument()
    })
    // Folder + note rows BOTH carry role="treeitem".
    const items = screen.getAllByRole('treeitem')
    expect(items.length).toBeGreaterThanOrEqual(2)
  })

  test('folder rows expose aria-expanded reflecting their open state', async () => {
    const f1 = makeFolder()
    useFolderStore.setState({
      folders: [f1],
      activeFolderId: null,
      // Start collapsed.
      expandedFolders: { [f1.id]: false },
    })

    render(<FolderTree onRightClick={() => {}} />)

    let row: HTMLElement | null = null
    await waitFor(() => {
      row = document.querySelector(`[data-folder-id="${f1.id}"]`) as HTMLElement | null
      expect(row).not.toBeNull()
    })
    // The treeitem is the OUTER wrapper around the row + (when expanded)
    // the child group. Walk up from the labelled inner row to find it.
    const treeitem = row!.closest('[role="treeitem"]') as HTMLElement | null
    expect(treeitem).not.toBeNull()
    expect(treeitem!.getAttribute('aria-expanded')).toBe('false')

    // Flip to expanded and re-query.
    await act(async () => {
      useFolderStore.setState({ expandedFolders: { [f1.id]: true } })
    })
    await waitFor(() => {
      const updated = document.querySelector(`[data-folder-id="${f1.id}"]`)!.closest('[role="treeitem"]')
      expect(updated!.getAttribute('aria-expanded')).toBe('true')
    })
  })
})

describe('Modal — ARIA + focus management', () => {
  test('role="dialog" + aria-modal=true + aria-labelledby when a title is set', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test dialog">
        <button>Inside</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
    expect(screen.getByText('Test dialog')).toHaveAttribute('id', 'modal-title')
  })

  test('moves focus inside the dialog on open and restores it on close', async () => {
    // Trigger element receives focus first — represents whatever opened
    // the modal (a sidebar button, a context menu, etc.).
    const trigger = document.createElement('button')
    trigger.textContent = 'open'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { rerender, unmount } = render(
      <Modal isOpen={true} onClose={() => {}} title="Focus test">
        <button>First</button>
        <button>Second</button>
      </Modal>,
    )

    // Focus should land on the close button (first focusable) — wait one
    // frame for the rAF inside Modal to commit.
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null
      expect(active).not.toBeNull()
      // First focusable is the X close button (aria-label="Close modal").
      expect(active!.getAttribute('aria-label')).toBe('Close modal')
    })

    // Close + verify focus returned to the trigger.
    rerender(
      <Modal isOpen={false} onClose={() => {}} title="Focus test">
        <button>First</button>
        <button>Second</button>
      </Modal>,
    )
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })

    unmount()
    document.body.removeChild(trigger)
  })
})
