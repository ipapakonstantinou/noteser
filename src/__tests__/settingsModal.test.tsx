/**
 * settingsModal.test.tsx
 *
 * Verifies the 2-pane Settings layout:
 *   - Both columns mount (categories on the left, panel on the right).
 *   - Default category is "General".
 *   - Clicking a category swaps the right pane.
 *   - aria-current marks the active category.
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

import { SettingsModal } from '../components/modals/SettingsModal'
import { useUIStore } from '../stores/uiStore'

beforeEach(() => {
  useUIStore.setState({
    sidebarCollapsed: false,
    sidebarWidth: 256,
    isSearchOpen: false,
    searchQuery: '',
    isPreviewMode: false,
    contextMenu: null,
    modal: { type: 'settings' },
    currentView: 'notes',
    renameRequest: null,
  })
})

describe('SettingsModal — 2-pane layout', () => {
  test('renders the left category nav and the right content pane', () => {
    render(<SettingsModal />)
    expect(screen.getByTestId('settings-categories')).toBeInTheDocument()
    // General is the default category — its panel should be mounted.
    expect(screen.getByTestId('settings-panel-general')).toBeInTheDocument()
  })

  test('all expected categories appear in the nav', () => {
    render(<SettingsModal />)
    const expected = [
      'general', 'editor', 'attachments', 'daily-notes', 'templates',
      'github', 'ai', 'shortcuts', 'export', 'about',
    ]
    for (const id of expected) {
      expect(screen.getByTestId(`settings-cat-${id}`)).toBeInTheDocument()
    }
  })

  test('default active category is General (aria-current set)', () => {
    render(<SettingsModal />)
    expect(screen.getByTestId('settings-cat-general')).toHaveAttribute('aria-current', 'page')
    // No other category is marked current.
    expect(screen.getByTestId('settings-cat-editor')).not.toHaveAttribute('aria-current')
  })

  test('clicking a category swaps the right pane', () => {
    render(<SettingsModal />)
    expect(screen.getByTestId('settings-panel-general')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-cat-about'))
    expect(screen.queryByTestId('settings-panel-general')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-panel-about')).toBeInTheDocument()
  })

  test('clicking a category updates aria-current', () => {
    render(<SettingsModal />)
    fireEvent.click(screen.getByTestId('settings-cat-editor'))
    expect(screen.getByTestId('settings-cat-editor')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('settings-cat-general')).not.toHaveAttribute('aria-current')
  })

  test('About panel exposes the builder link and GitHub link', () => {
    render(<SettingsModal />)
    fireEvent.click(screen.getByTestId('settings-cat-about'))
    const links = screen.getAllByRole('link')
    expect(links.some(a => a.getAttribute('href') === 'https://thetechjon.com')).toBe(true)
    expect(links.some(a => a.getAttribute('href')?.includes('github.com'))).toBe(true)
  })

  test('returns null when modal is closed', () => {
    useUIStore.setState({ modal: { type: null } })
    const { container } = render(<SettingsModal />)
    expect(container.firstChild).toBeNull()
  })
})
