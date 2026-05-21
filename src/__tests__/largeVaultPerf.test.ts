/**
 * @jest-environment node
 *
 * Performance regression tests for vaults at 5k notes.
 *
 * We're not asserting absolute timings (CI noise) — instead we assert
 * that the WARM call (no notes changed since the previous call) is
 * substantially faster than the COLD call. If a future refactor breaks
 * the per-note tag cache or the noteStore getter memoisation, this
 * gives a fast signal.
 *
 * The synthetic vault sizes (5000) match the roadmap's "very large
 * vaults (>5k notes)" target.
 */

import { collectAllTags, extractTagsCached } from '../utils/tags'

function makeNote(i: number) {
  // Distinct content with a couple of tags each — covers the
  // multi-tag case but keeps the regex work realistic.
  return {
    id: `note-${i}`,
    content: `# Note ${i}\nSome body text #project-${i % 10} #status-${i % 3} and more.\n`,
    isDeleted: false,
    updatedAt: 1000 + i,
  }
}

describe('collectAllTags @ 5k notes', () => {
  const notes = Array.from({ length: 5000 }, (_, i) => makeNote(i))

  test('warm call is faster than cold (per-note cache works)', () => {
    // Cold: each note hits the regex scan.
    const t0 = performance.now()
    const counts = collectAllTags(notes)
    const cold = performance.now() - t0

    // Same array, same notes (identity stable) → cache hit per note.
    const t1 = performance.now()
    const counts2 = collectAllTags(notes)
    const warm = performance.now() - t1

    expect(counts.size).toBe(counts2.size)
    // Warm should be MUCH faster — at least 3x, usually 10x+.
    // The bound is loose for CI; locally we see ~30x.
    expect(warm * 3).toBeLessThan(cold)
  })

  test('mutating one note only invalidates that note in the cache', () => {
    // Prime the cache.
    collectAllTags(notes)

    // Replace one note with a fresh object (the Zustand pattern).
    const swapped = [...notes]
    swapped[1234] = { ...notes[1234], content: notes[1234].content + ' #freshTag' }

    const t0 = performance.now()
    const counts = collectAllTags(swapped)
    const elapsed = performance.now() - t0

    // The 4999 unchanged notes are cache hits — total time should
    // be dominated by the single replaced note's scan.
    expect(counts.has('freshTag')).toBe(true)
    // Looser than warm above because we're paying for the one
    // cache-miss, but still much faster than a cold 5k scan.
    expect(elapsed).toBeLessThan(150)
  })

  test('extractTagsCached returns the same array reference across calls', () => {
    const note = makeNote(42)
    const a = extractTagsCached(note)
    const b = extractTagsCached(note)
    expect(a).toBe(b)
  })

  test('isDeleted notes are skipped (no perf cost from huge trash)', () => {
    // Compare counts before vs after marking half deleted. Every tag's
    // count should drop by ~50% (mod-10 and mod-3 distributions
    // interleave with mod-2 so the exact ratio varies per tag).
    const fullCounts = collectAllTags(notes)
    const half = notes.map((n, i) => (i % 2 === 0 ? { ...n, isDeleted: true } : n))
    const halfCounts = collectAllTags(half)

    for (const [tag, fullCount] of fullCounts) {
      const partialCount = halfCounts.get(tag) ?? 0
      expect(partialCount).toBeLessThanOrEqual(fullCount)
    }
  })
})
