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

// Default strip is everything EXCEPT calendar — calendar is pinned by
// default and resolveTabOrder filters pinned ids out.
const STRIP_DEFAULT = [
  'files', 'outline', 'source-control', 'search', 'bookmarks',
] as const

test('empty saved list + default pin returns the strip-default order', () => {
  expect(resolveTabOrder([], ['calendar'])).toEqual(STRIP_DEFAULT)
})

test('with no pin, calendar appears in the strip too', () => {
  // resolveTabOrder defaults to pinned=[]; calendar is then known and
  // appended at the tail of source order.
  expect(resolveTabOrder([])).toEqual([
    'calendar', 'files', 'outline', 'source-control', 'search', 'bookmarks',
  ])
})

test('respects the user-saved order verbatim when complete', () => {
  const saved = ['bookmarks', 'search', 'source-control', 'outline', 'files']
  expect(resolveTabOrder(saved, ['calendar'])).toEqual(saved)
})

test('appends missing ids in source-order at the tail', () => {
  expect(resolveTabOrder(['outline', 'files'], ['calendar'])).toEqual([
    'outline', 'files', 'source-control', 'search', 'bookmarks',
  ])
})

test('drops unknown ids', () => {
  expect(resolveTabOrder(['files', 'ancient-deleted-tab', 'outline'], ['calendar'])).toEqual([
    'files', 'outline', 'source-control', 'search', 'bookmarks',
  ])
})

test('de-duplicates repeated ids', () => {
  expect(resolveTabOrder(['files', 'outline', 'files', 'outline'], ['calendar'])).toEqual([
    'files', 'outline', 'source-control', 'search', 'bookmarks',
  ])
})

test('filters out pinned ids no matter where they appear in saved', () => {
  // User saved an order that included calendar; once pinned, it must
  // be removed from the strip.
  expect(resolveTabOrder(['calendar', 'files', 'outline'], ['calendar'])).toEqual([
    'files', 'outline', 'source-control', 'search', 'bookmarks',
  ])
})

test('multiple pinned ids all skip the strip', () => {
  expect(resolveTabOrder([], ['calendar', 'outline'])).toEqual([
    'files', 'source-control', 'search', 'bookmarks',
  ])
})

test('all panels pinned → strip is empty', () => {
  expect(resolveTabOrder([], [
    'calendar', 'files', 'outline', 'source-control', 'search', 'bookmarks',
  ])).toEqual([])
})
