// Locks the right-sidebar collapse/expand contract: thin strip when
// closed, full body when open, hidden when `hidden` is set, toggle
// button flips the persisted store flag.

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { RightSidebar } from '../components/sidebar/RightSidebar'
import { useUIStore } from '../stores/uiStore'
import { useNoteStore } from '../stores/noteStore'

beforeEach(() => {
  useUIStore.setState({ rightSidebarOpen: false })
  useNoteStore.setState({ notes: [], selectedNoteId: null })
})

describe('RightSidebar — visibility', () => {
  it('renders nothing when `hidden` is true (mobile case)', () => {
    const { container } = render(<RightSidebar hidden />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the toggle strip even when closed', () => {
    render(<RightSidebar />)
    expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('right-sidebar-toggle')).toBeInTheDocument()
    // PropertiesPanel body is NOT mounted when closed.
    expect(screen.queryByTestId('properties-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument()
  })

  it('reveals the panel body when open', () => {
    useUIStore.setState({ rightSidebarOpen: true })
    render(<RightSidebar />)
    expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'true')
    // PropertiesPanel renders — its empty state since no note seeded.
    expect(screen.getByTestId('properties-empty')).toBeInTheDocument()
  })
})

describe('RightSidebar — toggle', () => {
  it('flipping the toggle button updates rightSidebarOpen in the store', () => {
    render(<RightSidebar />)
    expect(useUIStore.getState().rightSidebarOpen).toBe(false)
    fireEvent.click(screen.getByTestId('right-sidebar-toggle'))
    expect(useUIStore.getState().rightSidebarOpen).toBe(true)
    fireEvent.click(screen.getByTestId('right-sidebar-toggle'))
    expect(useUIStore.getState().rightSidebarOpen).toBe(false)
  })

  it('exposes the right ARIA semantics on the toggle', () => {
    render(<RightSidebar />)
    const btn = screen.getByTestId('right-sidebar-toggle')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(btn).toHaveAttribute('aria-controls', 'right-sidebar-body')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })
})
