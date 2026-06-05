/**
 * settingsSearch.test.tsx
 *
 * Unit tests for the in-modal Settings search:
 *   - filterSettingsCatalog matches label, description, category, and
 *     keywords case-insensitively and returns an empty list on no match.
 *   - The Settings modal search input clears on Escape while the modal
 *     stays open.
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

import {
  filterSettingsCatalog,
} from '../components/modals/settings/filterSettingsCatalog'
import {
  SETTINGS_CATALOG,
  type SettingsCatalogEntry,
} from '../components/modals/settings/settingsCatalog'
import { SettingsModal } from '../components/modals/SettingsModal'
import { useUIStore } from '../stores/uiStore'

describe('filterSettingsCatalog', () => {
  const sample: readonly SettingsCatalogEntry[] = [
    {
      id: 'a.one',
      categoryId: 'editor',
      categoryLabel: 'Editor',
      label: 'Open notes in preview mode',
      description: 'Clicking a note opens the rendered markdown.',
      keywords: ['preview', 'render'],
    },
    {
      id: 'a.two',
      categoryId: 'github',
      categoryLabel: 'GitHub sync',
      label: 'Auto-sync on startup',
      description: 'Pull and push once at boot.',
      keywords: ['github', 'sync'],
    },
    {
      id: 'a.three',
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      label: 'Text font',
      description: 'Font used for note bodies.',
      keywords: ['typography'],
    },
  ]

  test('returns empty list for empty query', () => {
    expect(filterSettingsCatalog(sample, '')).toEqual([])
    expect(filterSettingsCatalog(sample, '   ')).toEqual([])
  })

  test('matches against label, case-insensitive', () => {
    const out = filterSettingsCatalog(sample, 'PREVIEW')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a.one')
  })

  test('matches against description', () => {
    const out = filterSettingsCatalog(sample, 'boot')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a.two')
  })

  test('matches against category label', () => {
    const out = filterSettingsCatalog(sample, 'github')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a.two')
  })

  test('matches against keywords', () => {
    const out = filterSettingsCatalog(sample, 'typography')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a.three')
  })

  test('returns empty list when no entry matches', () => {
    expect(filterSettingsCatalog(sample, 'xyznevermatches')).toEqual([])
  })

  test('catalog itself has entries and matches realistic queries', () => {
    expect(SETTINGS_CATALOG.length).toBeGreaterThan(0)
    expect(filterSettingsCatalog(SETTINGS_CATALOG, 'font').length).toBeGreaterThan(0)
    expect(filterSettingsCatalog(SETTINGS_CATALOG, 'shortcut').length).toBeGreaterThan(0)
  })
})

describe('SettingsModal search input', () => {
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

  test('renders the search input with the documented placeholder', () => {
    render(<SettingsModal />)
    const input = screen.getByTestId('settings-search-input') as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.placeholder).toBe('Search settings')
  })

  test('typing a query swaps the category panel for the results list', () => {
    render(<SettingsModal />)
    const input = screen.getByTestId('settings-search-input')
    fireEvent.change(input, { target: { value: 'font' } })
    expect(screen.getByTestId('settings-search-results')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-panel-general')).not.toBeInTheDocument()
  })

  test('no-match query renders the documented empty state', () => {
    render(<SettingsModal />)
    const input = screen.getByTestId('settings-search-input')
    fireEvent.change(input, { target: { value: 'zzznotathing' } })
    const empty = screen.getByTestId('settings-search-empty')
    expect(empty.textContent).toBe('No settings match “zzznotathing”.')
  })

  test('Escape on the search input clears the query and leaves the modal open', () => {
    render(<SettingsModal />)
    const input = screen.getByTestId('settings-search-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'font' } })
    expect(input.value).toBe('font')

    // Focus then dispatch Escape via the document so the capture-phase
    // listener (which beats the Modal close handler) fires.
    act(() => {
      input.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect((screen.getByTestId('settings-search-input') as HTMLInputElement).value).toBe('')
    // Modal stayed open — category panel is back in the DOM.
    expect(screen.getByTestId('settings-panel-general')).toBeInTheDocument()
  })

  test('clear button empties the query', () => {
    render(<SettingsModal />)
    const input = screen.getByTestId('settings-search-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'font' } })
    fireEvent.click(screen.getByTestId('settings-search-clear'))
    expect((screen.getByTestId('settings-search-input') as HTMLInputElement).value).toBe('')
  })
})
