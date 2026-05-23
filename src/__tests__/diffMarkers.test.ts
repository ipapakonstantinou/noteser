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

import { computeDiffMarkers, computeHunkRevert } from '../utils/diffMarkers'

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

// ── computeHunkRevert ────────────────────────────────────────────────────────

describe('computeHunkRevert', () => {
  test('returns null when no baseline (first-push case)', () => {
    expect(computeHunkRevert('a\nb', '', 1)).toBeNull()
  })

  test('returns null when the target line is unchanged', () => {
    // local + baseline identical → no hunks.
    expect(computeHunkRevert('a\nb\nc', 'a\nb\nc', 2)).toBeNull()
  })

  test('reverts a single modified line to the baseline content', () => {
    const local = 'a\nMODIFIED\nc'
    const baseline = 'a\nb\nc'
    const r = computeHunkRevert(local, baseline, 2)
    expect(r).toEqual({ fromLine: 2, toLine: 2, insert: 'b' })
  })

  test('reverts an added line by deleting it (insert: empty)', () => {
    // 'NEW' was added at line 1; baseline had no equivalent.
    const local = 'NEW\na\nb'
    const baseline = 'a\nb'
    const r = computeHunkRevert(local, baseline, 1)
    expect(r).toEqual({ fromLine: 1, toLine: 1, insert: '' })
  })

  test('reverts a multi-line change as one hunk', () => {
    // Three modified lines in a row → one hunk.
    const local = 'a\nX\nY\nZ\nd'
    const baseline = 'a\nb\nc\nd'
    // Click line 3 (middle of the hunk) — should revert lines 2-4.
    const r = computeHunkRevert(local, baseline, 3)
    expect(r).toEqual({ fromLine: 2, toLine: 4, insert: 'b\nc' })
  })

  test('returns the SAME hunk regardless of which line in the hunk the click was on', () => {
    const local = 'a\nX\nY\nZ\nd'
    const baseline = 'a\nb\nc\nd'
    const r2 = computeHunkRevert(local, baseline, 2)
    const r3 = computeHunkRevert(local, baseline, 3)
    const r4 = computeHunkRevert(local, baseline, 4)
    expect(r2).toEqual(r3)
    expect(r3).toEqual(r4)
  })
})
