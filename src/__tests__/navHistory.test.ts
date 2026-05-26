import {
  createHistory,
  currentEntry,
  canGoBack,
  canGoForward,
  push,
  back,
  forward,
  pruneHistory,
} from '@/utils/navHistory'

describe('navHistory', () => {
  it('starts empty with no current entry and no navigation', () => {
    const h = createHistory()
    expect(h.entries).toEqual([])
    expect(h.index).toBe(-1)
    expect(currentEntry(h)).toBeNull()
    expect(canGoBack(h)).toBe(false)
    expect(canGoForward(h)).toBe(false)
  })

  it('push appends and moves the cursor to the new entry', () => {
    let h = createHistory()
    h = push(h, 'a')
    expect(currentEntry(h)).toBe('a')
    expect(canGoBack(h)).toBe(false)
    h = push(h, 'b')
    expect(currentEntry(h)).toBe('b')
    expect(h.entries).toEqual(['a', 'b'])
    expect(canGoBack(h)).toBe(true)
    expect(canGoForward(h)).toBe(false)
  })

  it('pushing the current entry again is a no-op (no duplicate, same ref)', () => {
    let h = push(createHistory(), 'a')
    const same = push(h, 'a')
    expect(same).toBe(h)
    h = push(h, 'b')
    const sameB = push(h, 'b')
    expect(sameB).toBe(h)
    expect(h.entries).toEqual(['a', 'b'])
  })

  it('back / forward move the cursor through A → B → C', () => {
    let h = createHistory()
    h = push(h, 'a')
    h = push(h, 'b')
    h = push(h, 'c')
    expect(currentEntry(h)).toBe('c')

    h = back(h)
    expect(currentEntry(h)).toBe('b')
    h = back(h)
    expect(currentEntry(h)).toBe('a')
    expect(canGoBack(h)).toBe(false)

    h = forward(h)
    expect(currentEntry(h)).toBe('b')
    h = forward(h)
    expect(currentEntry(h)).toBe('c')
    expect(canGoForward(h)).toBe(false)
  })

  it('back at the start and forward at the end are no-ops (same ref)', () => {
    let h = push(push(createHistory(), 'a'), 'b')
    h = back(h) // now at 'a'
    const atStart = back(h)
    expect(atStart).toBe(h)
    expect(currentEntry(atStart)).toBe('a')

    let f = push(push(createHistory(), 'a'), 'b') // at 'b' (end)
    const atEnd = forward(f)
    expect(atEnd).toBe(f)
    expect(currentEntry(atEnd)).toBe('b')
  })

  it('going back then pushing a new id truncates the forward entries', () => {
    let h = createHistory()
    h = push(h, 'a')
    h = push(h, 'b')
    h = push(h, 'c') // a, b, [c]
    h = back(h) // a, [b], c
    h = back(h) // [a], b, c
    expect(currentEntry(h)).toBe('a')
    expect(canGoForward(h)).toBe(true)

    h = push(h, 'd') // truncates b, c → a, [d]
    expect(h.entries).toEqual(['a', 'd'])
    expect(currentEntry(h)).toBe('d')
    expect(canGoForward(h)).toBe(false)
    expect(canGoBack(h)).toBe(true)
  })

  it('pruneHistory drops deleted ids and collapses duplicates, keeping the cursor on the live target', () => {
    let h = createHistory()
    h = push(h, 'a')
    h = push(h, 'b')
    h = push(h, 'c') // [a, b, c], cursor at c
    h = back(h) // cursor at b

    const pruned = pruneHistory(h, new Set(['a', 'c']))
    // 'b' removed → entries [a, c]; cursor was on 'b' (gone) so it clamps.
    expect(pruned.entries).toEqual(['a', 'c'])
    expect(pruned.index).toBeGreaterThanOrEqual(0)
    expect(pruned.index).toBeLessThan(pruned.entries.length)
  })

  it('pruneHistory re-anchors the cursor onto the surviving current entry', () => {
    let h = createHistory()
    h = push(h, 'a')
    h = push(h, 'b')
    h = push(h, 'c')
    h = back(h) // cursor at 'b'
    const pruned = pruneHistory(h, new Set(['b', 'c'])) // drop 'a'
    expect(pruned.entries).toEqual(['b', 'c'])
    expect(currentEntry(pruned)).toBe('b')
  })

  it('pruneHistory returns an empty history when nothing survives', () => {
    let h = push(push(createHistory(), 'a'), 'b')
    const pruned = pruneHistory(h, new Set<string>())
    expect(pruned.entries).toEqual([])
    expect(pruned.index).toBe(-1)
  })

  it('pruneHistory is a no-op (same ref) when all entries are live', () => {
    let h = push(push(createHistory(), 'a'), 'b')
    const pruned = pruneHistory(h, new Set(['a', 'b']))
    expect(pruned).toBe(h)
  })
})
