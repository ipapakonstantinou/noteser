import { pushRecent, pruneRecents, RECENTS_CAP } from '../utils/recents'

describe('pushRecent', () => {
  it('adds a new id to the front', () => {
    expect(pushRecent([], 'a')).toEqual(['a'])
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('moves an existing id to the front, de-duplicating', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('is a no-op (same reference) when the id is already at the front', () => {
    const recents = ['a', 'b', 'c']
    expect(pushRecent(recents, 'a')).toBe(recents)
  })

  it('caps the list, dropping the oldest entries', () => {
    const ids = Array.from({ length: RECENTS_CAP }, (_, i) => `n${i}`)
    const next = pushRecent(ids, 'fresh')
    expect(next).toHaveLength(RECENTS_CAP)
    expect(next[0]).toBe('fresh')
    // The oldest entry (last in the list) is dropped.
    expect(next).not.toContain(`n${RECENTS_CAP - 1}`)
  })

  it('honours a custom cap', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 2)).toEqual(['d', 'a'])
  })

  it('does not duplicate when re-opening within a capped list', () => {
    const ids = Array.from({ length: RECENTS_CAP }, (_, i) => `n${i}`)
    const next = pushRecent(ids, 'n5')
    expect(next).toHaveLength(RECENTS_CAP)
    expect(next.filter(id => id === 'n5')).toHaveLength(1)
    expect(next[0]).toBe('n5')
  })
})

describe('pruneRecents', () => {
  it('drops ids not in the live set, preserving order', () => {
    const live = new Set(['a', 'c'])
    expect(pruneRecents(['a', 'b', 'c'], live)).toEqual(['a', 'c'])
  })

  it('returns the same reference when nothing is removed', () => {
    const recents = ['a', 'b']
    expect(pruneRecents(recents, new Set(['a', 'b', 'z']))).toBe(recents)
  })

  it('returns an empty list when no ids survive', () => {
    expect(pruneRecents(['a', 'b'], new Set())).toEqual([])
  })
})
