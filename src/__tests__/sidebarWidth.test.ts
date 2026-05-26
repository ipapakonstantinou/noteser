/**
 * sidebarWidth.test.ts
 *
 * Covers the drag-to-resize left-sidebar width state in useUIStore:
 *   - clampSidebarWidth bounds + rounds (the shared drag/keyboard helper)
 *   - setSidebarWidth goes through the same clamp
 *   - the default matches the documented constant
 *   - the value is in the persisted (partialize) slice
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import {
  useUIStore,
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '../stores/uiStore'

beforeEach(() => {
  useUIStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH })
})

// ── clampSidebarWidth (pure helper, shared by drag + keyboard) ─────────────

test('clampSidebarWidth floors below the minimum', () => {
  expect(clampSidebarWidth(0)).toBe(MIN_SIDEBAR_WIDTH)
  expect(clampSidebarWidth(-9999)).toBe(MIN_SIDEBAR_WIDTH)
  expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 1)).toBe(MIN_SIDEBAR_WIDTH)
})

test('clampSidebarWidth caps above the maximum', () => {
  expect(clampSidebarWidth(9999)).toBe(MAX_SIDEBAR_WIDTH)
  expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 1)).toBe(MAX_SIDEBAR_WIDTH)
})

test('clampSidebarWidth passes through + rounds an in-range value', () => {
  expect(clampSidebarWidth(300)).toBe(300)
  expect(clampSidebarWidth(312.4)).toBe(312)
  expect(clampSidebarWidth(312.6)).toBe(313)
})

test('bounds are internally consistent', () => {
  expect(MIN_SIDEBAR_WIDTH).toBeLessThan(MAX_SIDEBAR_WIDTH)
  expect(DEFAULT_SIDEBAR_WIDTH).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH)
  expect(DEFAULT_SIDEBAR_WIDTH).toBeLessThanOrEqual(MAX_SIDEBAR_WIDTH)
})

// ── setSidebarWidth (store action) ─────────────────────────────────────────

test('default sidebar width matches the documented constant', () => {
  expect(useUIStore.getState().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
  expect(DEFAULT_SIDEBAR_WIDTH).toBe(256)
})

test('setSidebarWidth clamps and rounds via the shared helper', () => {
  const { setSidebarWidth } = useUIStore.getState()

  setSidebarWidth(50)
  expect(useUIStore.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH)

  setSidebarWidth(10_000)
  expect(useUIStore.getState().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH)

  setSidebarWidth(333.7)
  expect(useUIStore.getState().sidebarWidth).toBe(334)
})

test('a drag-then-commit round-trip lands on a clamped width', () => {
  const { setSidebarWidth } = useUIStore.getState()
  // Simulate a drag that starts at 256 and overshoots far right.
  const startW = 256
  const dx = 999 // pointer dragged way past the editor
  setSidebarWidth(startW + dx)
  expect(useUIStore.getState().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH)
})

// ── persistence ────────────────────────────────────────────────────────────

test('sidebarWidth is included in the persisted slice', () => {
  const opts = useUIStore.persist.getOptions()
  const persisted = opts.partialize!({
    ...useUIStore.getState(),
    sidebarWidth: 321,
  } as ReturnType<typeof useUIStore.getState>)
  expect(persisted).toHaveProperty('sidebarWidth', 321)
})
