/**
 * sidebarResizeHandle.test.tsx
 *
 * The SidebarResizeHandle is the vertical divider the user drags to set
 * the left-sidebar width. These tests cover the interactive paths that
 * the store unit tests (sidebarWidth.test.ts) can't reach:
 *   - mouse drag updates + commits the clamped width
 *   - arrow-key resize (accessibility) steps the width and clamps
 *   - double-click resets to the default
 *   - the ARIA separator contract (role/orientation/valuenow)
 *
 * idb-keyval is mocked so Zustand persist doesn't touch IndexedDB.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarResizeHandle } from '../components/sidebar/SidebarResizeHandle'
import {
  useUIStore,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '../stores/uiStore'

beforeEach(() => {
  useUIStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH })
})

const getHandle = () => screen.getByTestId('sidebar-resize-handle')

describe('SidebarResizeHandle — ARIA', () => {
  test('exposes a vertical separator with the width range', () => {
    render(<SidebarResizeHandle />)
    const handle = getHandle()
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', String(DEFAULT_SIDEBAR_WIDTH))
    expect(handle).toHaveAttribute('aria-valuemin', String(MIN_SIDEBAR_WIDTH))
    expect(handle).toHaveAttribute('aria-valuemax', String(MAX_SIDEBAR_WIDTH))
    expect(handle).toHaveAttribute('tabindex', '0')
  })
})

describe('SidebarResizeHandle — mouse drag', () => {
  test('dragging right widens the sidebar by the pointer delta', () => {
    render(<SidebarResizeHandle />)
    const handle = getHandle()

    fireEvent.mouseDown(handle, { button: 0, clientX: 256 })
    fireEvent.mouseMove(window, { clientX: 356 }) // +100px
    expect(useUIStore.getState().sidebarWidth).toBe(356)

    fireEvent.mouseUp(window)
    // Width persists after release.
    expect(useUIStore.getState().sidebarWidth).toBe(356)
  })

  test('dragging left narrows the sidebar and clamps at the minimum', () => {
    render(<SidebarResizeHandle />)
    const handle = getHandle()

    fireEvent.mouseDown(handle, { button: 0, clientX: 256 })
    fireEvent.mouseMove(window, { clientX: 0 }) // huge negative delta
    expect(useUIStore.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH)
    fireEvent.mouseUp(window)
  })

  test('a right-button mousedown does not start a drag', () => {
    render(<SidebarResizeHandle />)
    const handle = getHandle()

    fireEvent.mouseDown(handle, { button: 2, clientX: 256 })
    fireEvent.mouseMove(window, { clientX: 400 })
    // Unchanged — the drag never armed.
    expect(useUIStore.getState().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  test('mouse move after release does not keep resizing', () => {
    render(<SidebarResizeHandle />)
    const handle = getHandle()

    fireEvent.mouseDown(handle, { button: 0, clientX: 256 })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window)
    const settled = useUIStore.getState().sidebarWidth
    fireEvent.mouseMove(window, { clientX: 999 })
    expect(useUIStore.getState().sidebarWidth).toBe(settled)
  })
})

describe('SidebarResizeHandle — keyboard', () => {
  test('ArrowRight / ArrowLeft step the width', () => {
    render(<SidebarResizeHandle />)
    const handle = getHandle()

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(useUIStore.getState().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH + 16)

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(useUIStore.getState().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  test('Shift+Arrow takes a larger step', () => {
    render(<SidebarResizeHandle />)
    const handle = getHandle()

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(useUIStore.getState().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH + 64)
  })

  test('Home / End jump to the min / max width', () => {
    render(<SidebarResizeHandle />)
    const handle = getHandle()

    fireEvent.keyDown(handle, { key: 'End' })
    expect(useUIStore.getState().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH)

    fireEvent.keyDown(handle, { key: 'Home' })
    expect(useUIStore.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH)
  })
})

describe('SidebarResizeHandle — double-click reset', () => {
  test('double-click restores the default width', () => {
    useUIStore.setState({ sidebarWidth: 480 })
    render(<SidebarResizeHandle />)
    fireEvent.doubleClick(getHandle())
    expect(useUIStore.getState().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})
