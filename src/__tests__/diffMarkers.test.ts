/**
 * diffMarkers.test.ts
 *
 * Pure tests for computeDiffMarkers — the editor gutter's "what
 * changed since the last commit" classifier (109).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { computeDiffMarkers } from '../utils/diffMarkers'

test('identical strings produce no markers', () => {
  expect(computeDiffMarkers('a\nb\nc', 'a\nb\nc').size).toBe(0)
})

test('empty baseline (never pushed) produces no markers', () => {
  // First push case — don't paint the whole doc as modified.
  const m = computeDiffMarkers('hello\nworld', '')
  expect(m.size).toBe(0)
})

test('a single inserted line in the middle is "added"', () => {
  // Baseline: "a\nb"; current: "a\nNEW\nb". Line 2 = added.
  const m = computeDiffMarkers('a\nNEW\nb', 'a\nb')
  expect(m.get(2)).toBe('added')
  // Lines 1 and 3 are unchanged.
  expect(m.get(1)).toBeUndefined()
  expect(m.get(3)).toBeUndefined()
})

test('replacing one line is "modified"', () => {
  // Baseline: "a\nb\nc"; current: "a\nXXX\nc".
  const m = computeDiffMarkers('a\nXXX\nc', 'a\nb\nc')
  expect(m.get(2)).toBe('modified')
})

test('contiguous block of added lines all flag as "added"', () => {
  // Baseline: "a\nb"; current: "a\nX\nY\nZ\nb".
  const m = computeDiffMarkers('a\nX\nY\nZ\nb', 'a\nb')
  expect(m.get(2)).toBe('added')
  expect(m.get(3)).toBe('added')
  expect(m.get(4)).toBe('added')
  expect(m.get(5)).toBeUndefined() // "b" — unchanged
})

test('pure-deletion produces no markers (we don\'t render deletes)', () => {
  // Baseline: "a\nb\nc"; current: "a\nc".
  const m = computeDiffMarkers('a\nc', 'a\nb\nc')
  expect(m.size).toBe(0)
})

test('mixed hunk: some modified, extras added', () => {
  // Baseline has 2 lines, current has 4 lines in the same hunk —
  // first 2 are modified, last 2 are added.
  const m = computeDiffMarkers('A\nB\nC\nD', 'X\nY')
  expect(m.get(1)).toBe('modified')
  expect(m.get(2)).toBe('modified')
  expect(m.get(3)).toBe('added')
  expect(m.get(4)).toBe('added')
})

test('marker line numbers are 1-indexed (CodeMirror convention)', () => {
  const m = computeDiffMarkers('NEW\nb\nc', 'b\nc')
  expect(m.has(1)).toBe(true)
  expect(m.has(0)).toBe(false)
})
