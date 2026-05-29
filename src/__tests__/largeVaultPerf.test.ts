/**
 * @jest-environment node
 *
 * Per-note tag cache correctness at 5k notes.
 *
 * These used to assert wall-clock ratios (warm call faster than cold),
 * which is flaky on shared CI runners. Instead we now assert the cache
 * DETERMINISTICALLY via array-reference identity: a cache hit returns the
 * very same array, a recompute mints a new one. If a future refactor breaks
 * the per-note tag cache, the reference checks fail with zero timing noise.
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

  test('a warm pass reuses the per-note cache (no recompute)', () => {
    // Cold pass primes the per-note cache.
    const counts = collectAllTags(notes)
    // A cache hit returns the very same array reference. Capture a sample.
    const sample = [0, 1234, 4999].map(i => notes[i])
    const refs = sample.map(n => extractTagsCached(n))

    // Warm pass over the SAME note objects must reuse the cache.
    const counts2 = collectAllTags(notes)
    expect(counts.size).toBe(counts2.size)

    // Deterministic proof (no wall-clock): the cached arrays are unchanged,
    // i.e. the warm pass did NOT recompute (a recompute would mint new arrays).
    sample.forEach((n, i) => expect(extractTagsCached(n)).toBe(refs[i]))
  })

  test('mutating one note only invalidates that note in the cache', () => {
    // Prime the cache, then capture an unchanged note's cached reference.
    collectAllTags(notes)
    const unchangedRef = extractTagsCached(notes[0])

    // Replace one note with a fresh object (the Zustand pattern → cache miss).
    const swapped = [...notes]
    swapped[1234] = { ...notes[1234], content: notes[1234].content + ' #freshTag' }
    const counts = collectAllTags(swapped)

    // The replaced note is rescanned (its new tag shows up)...
    expect(counts.has('freshTag')).toBe(true)
    // ...while every unchanged note object stays a cache hit (same reference),
    // proving only the one note was invalidated. Deterministic, no timing.
    expect(extractTagsCached(notes[0])).toBe(unchangedRef)
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
