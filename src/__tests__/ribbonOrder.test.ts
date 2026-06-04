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
 * Source order after the 2026-05-22 Obsidian-parity rebuild:
 *   new-note, daily-note, command-palette, templates.
 * Previous item ids (notes / recent / tags from the filter-mode era,
 * plus the older backlinks / calendar / outline / github / trash) were
 * removed — old saved orders referencing them get silently filtered
 * out by the unknown-id branch, so users don't see phantom items.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { resolveRibbonOrder } from '../components/sidebar/Ribbon'

const DEFAULT_ORDER = ['new-note', 'daily-note', 'command-palette', 'templates', 'random-note'] as const

describe('resolveRibbonOrder', () => {
  test('empty saved list returns default order', () => {
    expect(resolveRibbonOrder([])).toEqual(DEFAULT_ORDER)
  })

  test('passes through a fully-specified valid order verbatim', () => {
    const saved = ['daily-note', 'templates', 'new-note', 'command-palette', 'random-note']
    expect(resolveRibbonOrder(saved)).toEqual(saved)
  })

  test('drops unknown ids — incl. every removed legacy id', () => {
    // 'notes' / 'recent' / 'tags' were valid before the 2026-05-22
    // rebuild; 'backlinks' / 'calendar' / 'outline' / 'trash' / 'github'
    // were valid before the earlier 2026-05-20 de-dup. All MUST be
    // silently dropped so a returning user's saved order doesn't
    // render phantom items.
    expect(
      resolveRibbonOrder(['new-note', 'banana', 'notes', 'recent', 'tags', 'calendar']),
    ).toEqual(['new-note', 'daily-note', 'command-palette', 'templates', 'random-note'])
  })

  test('appends new items (not in saved list) at the end', () => {
    expect(resolveRibbonOrder(['templates', 'new-note'])).toEqual([
      'templates', 'new-note', 'daily-note', 'command-palette', 'random-note',
    ])
  })

  test('de-duplicates a saved list', () => {
    expect(resolveRibbonOrder(['new-note', 'new-note', 'daily-note'])).toEqual([
      'new-note', 'daily-note', 'command-palette', 'templates', 'random-note',
    ])
  })
})
