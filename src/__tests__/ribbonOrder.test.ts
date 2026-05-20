/**
 * ribbonOrder.test.ts
 *
 * Verifies the pure merger that combines the user's saved ribbon order
 * with the source order from Ribbon.tsx. Properties to keep:
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

import { resolveRibbonOrder } from '../components/sidebar/Ribbon'

const DEFAULT_ORDER = [
  'notes', 'recent', 'tags', 'backlinks', 'calendar', 'outline', 'trash', 'github',
] as const

describe('resolveRibbonOrder', () => {
  test('empty saved list returns default order', () => {
    expect(resolveRibbonOrder([])).toEqual(DEFAULT_ORDER)
  })

  test('passes through a fully-specified valid order verbatim', () => {
    const saved = ['github', 'notes', 'recent', 'tags', 'backlinks', 'calendar', 'outline', 'trash']
    expect(resolveRibbonOrder(saved)).toEqual(saved)
  })

  test('drops unknown ids', () => {
    expect(resolveRibbonOrder(['notes', 'banana', 'recent'])).toEqual([
      'notes', 'recent',
      // The remaining items not in the saved list, in source order:
      'tags', 'backlinks', 'calendar', 'outline', 'trash', 'github',
    ])
  })

  test('appends new items (not in saved list) at the end', () => {
    // A user upgraded from a version that only had notes/recent. New items
    // appear after the saved order without overwriting their tweaks.
    expect(resolveRibbonOrder(['recent', 'notes'])).toEqual([
      'recent', 'notes',
      'tags', 'backlinks', 'calendar', 'outline', 'trash', 'github',
    ])
  })

  test('de-duplicates a saved list', () => {
    expect(resolveRibbonOrder(['notes', 'notes', 'recent'])).toEqual([
      'notes', 'recent',
      'tags', 'backlinks', 'calendar', 'outline', 'trash', 'github',
    ])
  })
})
