/**
 * sidebarTabOrder.test.ts
 *
 * Pure-function tests for the sidebar tab-strip order resolver — the
 * merger that combines the user's saved order (settingsStore.
 * sidebarTabOrder) with the source order from SidebarStack.tsx.
 *
 * Properties:
 *   - Unknown ids in the saved list are dropped.
 *   - Items not yet in the saved list are appended at the end.
 *   - Duplicates in the saved list are de-duped.
 *   - Empty saved list returns the full source order.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { resolveTabOrder } from '../components/sidebar/SidebarStack'

const DEFAULT_ORDER = [
  'files', 'outline', 'source-control', 'search', 'bookmarks',
] as const

test('empty saved list returns the full source order', () => {
  expect(resolveTabOrder([])).toEqual(DEFAULT_ORDER)
})

test('respects the user-saved order verbatim when complete', () => {
  const saved = ['bookmarks', 'search', 'source-control', 'outline', 'files']
  expect(resolveTabOrder(saved)).toEqual(saved)
})

test('appends missing ids in source-order at the tail', () => {
  // User only customised position of files and outline; the other 3
  // should follow in source order.
  expect(resolveTabOrder(['outline', 'files'])).toEqual([
    'outline', 'files', 'source-control', 'search', 'bookmarks',
  ])
})

test('drops unknown ids', () => {
  expect(resolveTabOrder(['files', 'ancient-deleted-tab', 'outline'])).toEqual([
    'files', 'outline', 'source-control', 'search', 'bookmarks',
  ])
})

test('de-duplicates repeated ids', () => {
  expect(resolveTabOrder(['files', 'outline', 'files', 'outline'])).toEqual([
    'files', 'outline', 'source-control', 'search', 'bookmarks',
  ])
})

test('saved order plus missing newly-added ids = saved + new', () => {
  // Simulates upgrade where the user had a custom order before
  // bookmarks shipped: bookmarks should appear at the tail.
  expect(resolveTabOrder(['search', 'files', 'outline', 'source-control'])).toEqual([
    'search', 'files', 'outline', 'source-control', 'bookmarks',
  ])
})
