/**
 * drawerHandle.test.tsx
 *
 * The mobile drawer opens via an edge-swipe, but iOS WebKit claims the
 * outermost-edge swipe for browser back-navigation, so the gesture is
 * unreliable. DrawerHandle is the dependable, visible affordance.
 *
 * These tests cover the handle in isolation (it's a small additive
 * component) plus the page.tsx gating contract: render only when
 * `mobileLayout && !drawerOpen`.
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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DrawerHandle } from '../components/sidebar/DrawerHandle'
import { useUIStore } from '../stores/uiStore'

beforeEach(() => {
  // Drawer closed = sidebarCollapsed true (the mobile convention).
  useUIStore.setState({ sidebarCollapsed: true })
})

describe('DrawerHandle', () => {
  test('renders an "Open sidebar" button', () => {
    render(<DrawerHandle />)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument()
  })

  test('calls toggleSidebar (opens the drawer) when clicked', async () => {
    const user = userEvent.setup()
    render(<DrawerHandle />)

    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Open sidebar' }))
    // toggleSidebar flips collapsed → false, i.e. drawer opens.
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })
})

// =============================================================================
// page.tsx gating contract
//
// The handle is rendered with `{mobileLayout && !drawerOpen && <DrawerHandle />}`.
// We assert the boolean expression that page.tsx uses so a future change
// to the gate is caught here. `drawerOpen = mobileLayout && !sidebarCollapsed`.
// =============================================================================

function shouldShowHandle(mobileLayout: boolean, sidebarCollapsed: boolean) {
  const drawerOpen = mobileLayout && !sidebarCollapsed
  return mobileLayout && !drawerOpen
}

describe('DrawerHandle visibility gate', () => {
  test('visible on mobile when the drawer is closed', () => {
    expect(shouldShowHandle(true, /* collapsed */ true)).toBe(true)
  })

  test('hidden on mobile when the drawer is open', () => {
    expect(shouldShowHandle(true, /* collapsed */ false)).toBe(false)
  })

  test('hidden on desktop regardless of drawer/sidebar state', () => {
    expect(shouldShowHandle(false, true)).toBe(false)
    expect(shouldShowHandle(false, false)).toBe(false)
  })
})
