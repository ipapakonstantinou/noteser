/**
 * sidebarTabOrder.test.ts
 *
 * Pure-function tests for the sidebar tab-strip order resolver — the
 * merger that combines the user's saved order with the source order
 * from SidebarStack.tsx. Pinned panels are filtered out of the main
 * bottom strip because each one gets its OWN mini-strip above its
 * content (Obsidian pane model).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { resolveTabOrder } from '../components/sidebar/SidebarStack'

// Full source order when nothing is pinned.
const SOURCE_ORDER = [
  'calendar', 'files', 'outline', 'source-control', 'search', 'bookmarks', 'related',
] as const

test('empty saved + empty pinned returns the full source order', () => {
  expect(resolveTabOrder([])).toEqual(SOURCE_ORDER)
})

test('pinned ids are filtered out of the main strip', () => {
  expect(resolveTabOrder([], ['calendar'])).toEqual([
    'files', 'outline', 'source-control', 'search', 'bookmarks', 'related',
  ])
  expect(resolveTabOrder([], ['calendar', 'outline'])).toEqual([
    'files', 'source-control', 'search', 'bookmarks', 'related',
  ])
})

test('respects the user-saved order verbatim when complete + unpinned', () => {
  const saved = ['related', 'bookmarks', 'search', 'source-control', 'outline', 'files', 'calendar']
  expect(resolveTabOrder(saved)).toEqual(saved)
})

test('saved order with pinned ids drops the pinned entries', () => {
  // User saved [calendar, files, outline]; calendar is now pinned →
  // strip only shows files + outline + (anything missing).
  expect(resolveTabOrder(['calendar', 'files', 'outline'], ['calendar'])).toEqual([
    'files', 'outline', 'source-control', 'search', 'bookmarks', 'related',
  ])
})

test('appends missing ids in source-order at the tail', () => {
  expect(resolveTabOrder(['outline', 'files'])).toEqual([
    'outline', 'files', 'calendar', 'source-control', 'search', 'bookmarks', 'related',
  ])
})

test('drops unknown ids', () => {
  expect(resolveTabOrder(['files', 'ancient-deleted-tab', 'outline'])).toEqual([
    'files', 'outline', 'calendar', 'source-control', 'search', 'bookmarks', 'related',
  ])
})

test('de-duplicates repeated ids', () => {
  expect(resolveTabOrder(['files', 'outline', 'files', 'outline'])).toEqual([
    'files', 'outline', 'calendar', 'source-control', 'search', 'bookmarks', 'related',
  ])
})

test('all panels pinned → strip is empty', () => {
  expect(resolveTabOrder([], [...SOURCE_ORDER])).toEqual([])
})
