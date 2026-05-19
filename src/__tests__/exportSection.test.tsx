/**
 * exportSection.test.tsx
 *
 * Render and click-behaviour test for the ExportSection settings block.
 * The section exists so the "Export notes" entry can live inside the
 * Settings modal alongside other vault-wide actions (it used to be a
 * footer button in the sidebar with the wrong icon).
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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ExportSection } from '../components/modals/ExportSection'
import { useUIStore } from '../stores/uiStore'

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

beforeEach(() => {
  resetUIStore()
})

describe('ExportSection', () => {
  test('renders the "Export notes" button', () => {
    render(<ExportSection />)
    expect(screen.getByRole('button', { name: /export notes/i })).toBeInTheDocument()
  })

  test('renders the explainer paragraph', () => {
    render(<ExportSection />)
    expect(
      screen.getByText(/Download all notes as markdown, JSON, or HTML/i),
    ).toBeInTheDocument()
  })

  test('clicking the button opens the Export modal via useUIStore', async () => {
    const user = userEvent.setup()
    render(<ExportSection />)

    expect(useUIStore.getState().modal.type).toBeNull()

    await user.click(screen.getByRole('button', { name: /export notes/i }))

    expect(useUIStore.getState().modal.type).toBe('export')
  })
})
