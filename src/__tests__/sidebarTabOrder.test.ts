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
 *   - The `pinned` arg is NOT used for filtering — pinned panels
 *     still show their icons in the strip so they stay discoverable
 *     while the panel content is rendered above.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { resolveTabOrder } from '../components/sidebar/SidebarStack'

// Default strip is every panel in the PANELS registry, source order.
// pinned no longer filters; specifying it should yield the same shape.
const SOURCE_ORDER = [
  'calendar', 'files', 'outline', 'source-control', 'search', 'bookmarks', 'related',
] as const

test('empty saved list returns the full source order', () => {
  expect(resolveTabOrder([])).toEqual(SOURCE_ORDER)
})

test('pinned arg is purely advisory — panels still appear in the strip', () => {
  // Earlier behaviour filtered out pinned ids; new behaviour keeps
  // them so the user sees the icon as a "jump to" affordance.
  expect(resolveTabOrder([], ['calendar'])).toEqual(SOURCE_ORDER)
  expect(resolveTabOrder([], ['calendar', 'outline'])).toEqual(SOURCE_ORDER)
})

test('respects the user-saved order verbatim when complete', () => {
  const saved = ['related', 'bookmarks', 'search', 'source-control', 'outline', 'files', 'calendar']
  expect(resolveTabOrder(saved)).toEqual(saved)
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

test('upgrade path: missing newly-added id (related) lands at the tail', () => {
  expect(resolveTabOrder(['search', 'files', 'outline', 'source-control'])).toEqual([
    'search', 'files', 'outline', 'source-control', 'calendar', 'bookmarks', 'related',
  ])
})
