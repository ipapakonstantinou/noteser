/**
 * calendarGrid.test.ts
 *
 * Covers the week-start math the sidebar Calendar uses to lay out its
 * grid: rotating the day-of-week headers and computing the leading-blank
 * offset before day 1 of the month. Both must agree for any start day or
 * the grid is off by a column.
 */

import { dayHeadersForWeekStart, leadingBlankCount } from '../utils/calendarGrid'

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
