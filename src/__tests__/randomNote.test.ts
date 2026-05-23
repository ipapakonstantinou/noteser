import { pickRandomNoteId } from '../utils/randomNote'

describe('pickRandomNoteId', () => {
  // Stable RNG for deterministic tests — returns the values in `vals`
  // in order, then loops.
  const seq = (vals: number[]) => {
    let i = 0
    return () => vals[i++ % vals.length]
  }

  test('returns null when there are no notes', () => {
    expect(pickRandomNoteId([], null)).toBeNull()
  })

  test('returns null when every note is soft-deleted', () => {
    const notes = [
      { id: 'a', isDeleted: true },
      { id: 'b', isDeleted: true },
    ]
    expect(pickRandomNoteId(notes, null)).toBeNull()
  })

  test('picks the only active note when the vault has one', () => {
    const notes = [{ id: 'a', isDeleted: false }]
    expect(pickRandomNoteId(notes, null)).toBe('a')
  })

  test('skips the current note when there is at least one other to pick', () => {
    // RNG always picks index 0 of the pool. Pool excludes current,
    // so the result must be different from current.
    const notes = [
      { id: 'a', isDeleted: false },
      { id: 'b', isDeleted: false },
      { id: 'c', isDeleted: false },
    ]
    const pick = pickRandomNoteId(notes, 'a', seq([0]))
    expect(pick).not.toBe('a')
    expect(['b', 'c']).toContain(pick)
  })

  test('returns the only active note even if it is the excluded one', () => {
    const notes = [{ id: 'a', isDeleted: false }]
    expect(pickRandomNoteId(notes, 'a')).toBe('a')
  })

  test('skips deleted notes when picking', () => {
    const notes = [
      { id: 'a', isDeleted: true },
      { id: 'b', isDeleted: false },
      { id: 'c', isDeleted: true },
    ]
    expect(pickRandomNoteId(notes, null, seq([0]))).toBe('b')
  })

  test('uses the supplied RNG (not Math.random)', () => {
    const notes = [
      { id: 'a', isDeleted: false },
      { id: 'b', isDeleted: false },
      { id: 'c', isDeleted: false },
    ]
    // rng = 0 → index 0; rng = 0.9 → index 2.
    expect(pickRandomNoteId(notes, null, () => 0)).toBe('a')
    expect(pickRandomNoteId(notes, null, () => 0.9)).toBe('c')
  })
})
