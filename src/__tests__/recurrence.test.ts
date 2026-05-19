/**
 * recurrence.test.ts
 *
 * Unit tests for `src/utils/recurrence.ts`. Pure functions, no stores.
 */

import {
  nextRecurrence,
  shiftISOByDays,
  isoDiffDays,
  isValidRecurrence,
} from '../utils/recurrence'

describe('nextRecurrence — basic units', () => {
  test('every day → +1 day', () => {
    expect(nextRecurrence('every day', '2026-05-20')).toBe('2026-05-21')
  })

  test('every week → +7 days', () => {
    expect(nextRecurrence('every week', '2026-05-20')).toBe('2026-05-27')
  })

  test('every month → +1 month, same day-of-month', () => {
    expect(nextRecurrence('every month', '2026-05-20')).toBe('2026-06-20')
  })

  test('every year → +1 year, same MM-DD', () => {
    expect(nextRecurrence('every year', '2026-05-20')).toBe('2027-05-20')
  })
})

describe('nextRecurrence — multiplier', () => {
  test('every 2 days', () => {
    expect(nextRecurrence('every 2 days', '2026-05-20')).toBe('2026-05-22')
  })

  test('every 3 weeks', () => {
    expect(nextRecurrence('every 3 weeks', '2026-05-20')).toBe('2026-06-10')
  })

  test('every 2 months', () => {
    expect(nextRecurrence('every 2 months', '2026-05-20')).toBe('2026-07-20')
  })

  test('every 5 years', () => {
    expect(nextRecurrence('every 5 years', '2026-05-20')).toBe('2031-05-20')
  })

  test('plural form (no s) is also accepted', () => {
    // The grammar allows the bare singular too: "every 2 week" → +14 days.
    // Obsidian only emits the plural form but we shouldn't be strict.
    expect(nextRecurrence('every 2 week', '2026-05-20')).toBe('2026-06-03')
  })
})

describe('nextRecurrence — "on the Nth"', () => {
  test('every month on the 1st jumps to the 1st of next month', () => {
    expect(nextRecurrence('every month on the 1st', '2026-05-20')).toBe('2026-06-01')
  })

  test('every month on the 15th', () => {
    expect(nextRecurrence('every month on the 15th', '2026-05-20')).toBe('2026-06-15')
  })

  test('on-the-31st clamps to the last day of months that have fewer days', () => {
    // Jan → Feb: Feb has 28 days in 2027 (non-leap) → clamp to 28th.
    expect(nextRecurrence('every month on the 31st', '2027-01-15')).toBe('2027-02-28')
  })

  test('on-the-31st with 2-month step', () => {
    expect(nextRecurrence('every 2 months on the 31st', '2026-05-15')).toBe('2026-07-31')
  })
})

describe('nextRecurrence — calendar edge cases', () => {
  test('Jan 31 + every month clamps to Feb 28 in non-leap year', () => {
    expect(nextRecurrence('every month', '2027-01-31')).toBe('2027-02-28')
  })

  test('Jan 31 + every month clamps to Feb 29 in leap year', () => {
    expect(nextRecurrence('every month', '2024-01-31')).toBe('2024-02-29')
  })

  test('Feb 29 + every year clamps to Feb 28 in non-leap target year', () => {
    expect(nextRecurrence('every year', '2024-02-29')).toBe('2025-02-28')
  })

  test('Dec 31 + every month wraps to Jan 31 of next year', () => {
    expect(nextRecurrence('every month', '2026-12-31')).toBe('2027-01-31')
  })
})

describe('nextRecurrence — "when done" suffix is tolerated', () => {
  test('rule still parses with "when done" appended', () => {
    // The toggle path treats "when done" specially (anchors on today rather
    // than the due date), but the rule itself must still parse cleanly here
    // so we can step forward from the anchor.
    expect(nextRecurrence('every week when done', '2026-05-20')).toBe('2026-05-27')
  })
})

describe('nextRecurrence — invalid input returns null', () => {
  test('garbage string', () => {
    expect(nextRecurrence('sometimes maybe', '2026-05-20')).toBeNull()
  })

  test('unsupported unit', () => {
    expect(nextRecurrence('every fortnight', '2026-05-20')).toBeNull()
  })

  test('malformed ISO anchor', () => {
    expect(nextRecurrence('every day', '2026/05/20')).toBeNull()
  })

  test('zero count is rejected', () => {
    expect(nextRecurrence('every 0 days', '2026-05-20')).toBeNull()
  })

  test('on the 32nd is rejected', () => {
    expect(nextRecurrence('every month on the 32nd', '2026-05-20')).toBeNull()
  })
})

describe('shiftISOByDays', () => {
  test('positive shift', () => {
    expect(shiftISOByDays('2026-05-20', 7)).toBe('2026-05-27')
  })

  test('negative shift', () => {
    expect(shiftISOByDays('2026-05-20', -1)).toBe('2026-05-19')
  })

  test('crosses month boundary forward', () => {
    expect(shiftISOByDays('2026-05-30', 5)).toBe('2026-06-04')
  })

  test('crosses year boundary backward', () => {
    expect(shiftISOByDays('2026-01-02', -3)).toBe('2025-12-30')
  })

  test('malformed input returns null', () => {
    expect(shiftISOByDays('bad', 1)).toBeNull()
  })
})

describe('isoDiffDays', () => {
  test('returns 7 for a one-week difference', () => {
    expect(isoDiffDays('2026-05-20', '2026-05-27')).toBe(7)
  })

  test('returns 0 when same date', () => {
    expect(isoDiffDays('2026-05-20', '2026-05-20')).toBe(0)
  })

  test('returns negative when target is before source', () => {
    expect(isoDiffDays('2026-05-20', '2026-05-13')).toBe(-7)
  })

  test('malformed input returns 0', () => {
    expect(isoDiffDays('bad', '2026-05-20')).toBe(0)
  })
})

describe('isValidRecurrence', () => {
  test('accepts well-formed rules', () => {
    expect(isValidRecurrence('every day')).toBe(true)
    expect(isValidRecurrence('every 2 weeks')).toBe(true)
    expect(isValidRecurrence('every month on the 1st')).toBe(true)
    expect(isValidRecurrence('every year when done')).toBe(true)
  })

  test('rejects garbage', () => {
    expect(isValidRecurrence('sometimes')).toBe(false)
    expect(isValidRecurrence('')).toBe(false)
    expect(isValidRecurrence('every fortnight')).toBe(false)
  })
})
