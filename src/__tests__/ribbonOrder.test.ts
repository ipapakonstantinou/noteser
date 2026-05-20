/**
 * ribbonOrder.test.ts
 *
 * Verifies the pure merger that combines the user's saved ribbon order
 * with the source order from Ribbon.tsx. Properties to keep:
 *   - Unknown ids in the saved list are dropped.
 *   - Items not yet in the saved list are appended at the end.
 *   - Duplicates in the saved list are de-duped.
 *   - Empty saved list returns the full source order.
 *
 * Source order after the 2026-05-20 de-dup: notes, recent, tags.
 * All the previous duplicate-with-the-tab-strip items (backlinks,
 * calendar, outline, trash, github) were removed — old saved orders
 * referencing them get silently filtered out by the unknown-id branch.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { resolveRibbonOrder } from '../components/sidebar/Ribbon'

const DEFAULT_ORDER = ['notes', 'recent', 'tags'] as const

describe('resolveRibbonOrder', () => {
  test('empty saved list returns default order', () => {
    expect(resolveRibbonOrder([])).toEqual(DEFAULT_ORDER)
  })

  test('passes through a fully-specified valid order verbatim', () => {
    const saved = ['recent', 'tags', 'notes']
    expect(resolveRibbonOrder(saved)).toEqual(saved)
  })

  test('drops unknown ids (incl. removed legacy ids)', () => {
    // 'backlinks' / 'calendar' / 'outline' / 'trash' / 'github' were
    // valid ribbon ids before the de-dup; they MUST be silently
    // dropped so a returning user's saved order doesn't render
    // phantom items.
    expect(resolveRibbonOrder(['notes', 'banana', 'recent', 'calendar', 'github'])).toEqual([
      'notes', 'recent', 'tags',
    ])
  })

  test('appends new items (not in saved list) at the end', () => {
    expect(resolveRibbonOrder(['recent', 'notes'])).toEqual(['recent', 'notes', 'tags'])
  })

  test('de-duplicates a saved list', () => {
    expect(resolveRibbonOrder(['notes', 'notes', 'recent'])).toEqual([
      'notes', 'recent', 'tags',
    ])
  })
})
