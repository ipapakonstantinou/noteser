/**
 * calendarGrid.test.ts
 *
 * Covers the week-start math the sidebar Calendar uses to lay out its
 * grid: rotating the day-of-week headers and computing the leading-blank
 * offset before day 1 of the month. Both must agree for any start day or
 * the grid is off by a column.
 */

import {
  dayHeadersForWeekStart,
  isoWeekNumber,
  leadingBlankCount,
  mondayOfIsoWeek,
} from '../utils/calendarGrid'

describe('dayHeadersForWeekStart', () => {
  test('Sunday start (0) → Su…Sa', () => {
    expect(dayHeadersForWeekStart(0)).toEqual([
      'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa',
    ])
  })

  test('Monday start (1) → Mo…Su', () => {
    expect(dayHeadersForWeekStart(1)).toEqual([
      'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su',
    ])
  })

  test('always returns 7 unique columns', () => {
    for (const start of [0, 1] as const) {
      const headers = dayHeadersForWeekStart(start)
      expect(headers).toHaveLength(7)
      expect(new Set(headers).size).toBe(7)
    }
  })
})

describe('leadingBlankCount', () => {
  // firstWeekday is JS Date.getDay() of the 1st of the month (0=Sun).
  test('Sunday start: blanks equal the weekday index directly', () => {
    expect(leadingBlankCount(0, 0)).toBe(0) // 1st is a Sunday
    expect(leadingBlankCount(3, 0)).toBe(3) // 1st is a Wednesday
    expect(leadingBlankCount(6, 0)).toBe(6) // 1st is a Saturday
  })

  test('Monday start: rotates so Monday is column 0', () => {
    expect(leadingBlankCount(1, 1)).toBe(0) // 1st is a Monday → no blanks
    expect(leadingBlankCount(0, 1)).toBe(6) // 1st is a Sunday → 6 blanks (last column)
    expect(leadingBlankCount(3, 1)).toBe(2) // 1st is a Wednesday → 2 blanks
    expect(leadingBlankCount(6, 1)).toBe(5) // 1st is a Saturday → 5 blanks
  })

  test('result is always in [0,6] for every weekday/start combination', () => {
    for (let weekday = 0; weekday <= 6; weekday++) {
      for (const start of [0, 1] as const) {
        const n = leadingBlankCount(weekday, start)
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThanOrEqual(6)
      }
    }
  })

  test('a concrete month lines up: May 2026 starts on a Friday', () => {
    // 2026-05-01 is a Friday → getDay() === 5.
    const firstWeekday = new Date(2026, 4, 1).getDay()
    expect(firstWeekday).toBe(5)
    // Sunday-first: Friday is column 5 → 5 blanks before day 1.
    expect(leadingBlankCount(firstWeekday, 0)).toBe(5)
    // Monday-first: Friday is column 4 → 4 blanks before day 1.
    expect(leadingBlankCount(firstWeekday, 1)).toBe(4)
  })
})

describe('isoWeekNumber', () => {
  test('mid-year reference dates return expected ISO week', () => {
    // 2026-01-05 (Monday) is the start of ISO week 2 (week 1 contains
    // 2026-01-01..04 because Jan 1 2026 is a Thursday).
    expect(isoWeekNumber(new Date(2026, 0, 5))).toBe(2)
    // 2026-06-04 (Thursday) → week 23.
    expect(isoWeekNumber(new Date(2026, 5, 4))).toBe(23)
    // 2026-12-28 (Monday) is week 53 — 2026 has a long year.
    expect(isoWeekNumber(new Date(2026, 11, 28))).toBe(53)
  })

  test('year-boundary edge cases follow ISO 8601', () => {
    // 2023-01-01 is a Sunday → still belongs to week 52 of 2022.
    expect(isoWeekNumber(new Date(2023, 0, 1))).toBe(52)
    // 2021-01-01 is a Friday → ISO week 53 of 2020.
    expect(isoWeekNumber(new Date(2021, 0, 1))).toBe(53)
    // 2024-12-30 (Monday) → week 1 of 2025 (because Jan 1 2025 is a
    // Wednesday, meaning week 1 starts Mon 2024-12-30).
    expect(isoWeekNumber(new Date(2024, 11, 30))).toBe(1)
    // 2025-12-29 (Monday) → week 1 of 2026.
    expect(isoWeekNumber(new Date(2025, 11, 29))).toBe(1)
  })

  test('returns a value in [1, 53]', () => {
    // Sample every day of 2025 — the result must stay in range.
    const start = new Date(2025, 0, 1).getTime()
    for (let i = 0; i < 365; i++) {
      const d = new Date(start + i * 86400000)
      const w = isoWeekNumber(d)
      expect(w).toBeGreaterThanOrEqual(1)
      expect(w).toBeLessThanOrEqual(53)
    }
  })
})

describe('mondayOfIsoWeek', () => {
  test('returns the Monday of the current ISO week for a Thursday', () => {
    // 2026-06-04 (Thursday) → Monday is 2026-06-01.
    const monday = mondayOfIsoWeek(new Date(2026, 5, 4))
    expect(monday.getFullYear()).toBe(2026)
    expect(monday.getMonth()).toBe(5) // June
    expect(monday.getDate()).toBe(1)
  })

  test('Sunday maps to the PRECEDING Monday (ISO weeks start Monday)', () => {
    // 2026-06-07 (Sunday) → Monday 2026-06-01 (six days earlier).
    const monday = mondayOfIsoWeek(new Date(2026, 5, 7))
    expect(monday.getDate()).toBe(1)
  })

  test('Monday is a no-op (returns same calendar day)', () => {
    const monday = mondayOfIsoWeek(new Date(2026, 5, 1))
    expect(monday.getDate()).toBe(1)
  })
})
