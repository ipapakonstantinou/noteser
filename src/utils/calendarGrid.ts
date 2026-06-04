// Pure helpers for the sidebar Calendar grid layout. Extracted from
// CalendarView so the week-start math (which is easy to get off-by-one)
// is unit-testable without rendering React.

import type { CalendarWeekStartDay } from '@/stores/settingsStore'

// Default Sunday-first day-of-week labels. The grid rotates these by the
// configured start day so column 0 always matches the leading-blank
// offset below.
const SUNDAY_FIRST_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

// Day-of-week column headers rotated so `startDay` is the first column.
// startDay 0 (Sunday) → ['Su','Mo',…,'Sa']; startDay 1 (Monday) →
// ['Mo','Tu',…,'Su'].
export const dayHeadersForWeekStart = (
  startDay: CalendarWeekStartDay,
): string[] => [
  ...SUNDAY_FIRST_HEADERS.slice(startDay),
  ...SUNDAY_FIRST_HEADERS.slice(0, startDay),
]

// Number of leading blank cells before day 1 of the month, given the
// JS getDay() value (0=Sun..6=Sat) of the first of the month and the
// configured week-start day. Always in [0,6].
export const leadingBlankCount = (
  firstWeekday: number,
  startDay: CalendarWeekStartDay,
): number => (firstWeekday - startDay + 7) % 7

// ISO 8601 week number for the given local date. Weeks start on
// Monday and week 1 is the one that contains the first Thursday of
// the year. The result is in [1, 53].
//
// Why duplicate the helper that already lives in dateFormat.ts?
//   • The calendar W-column renders the number visually; it doesn't
//     format an arbitrary moment-style token. Keeping the grid math
//     in calendarGrid (alongside dayHeadersForWeekStart +
//     leadingBlankCount) makes the unit tests sit next to each
//     other, so an off-by-one in either is caught in the same file.
//   • dateFormat.ts's isoWeek is private to that module — exposing it
//     would tie the calendar to the formatter's lifecycle. The two
//     functions are intentionally tiny and trivially proven by tests.
//
// Algorithm: shift to the Thursday of the current ISO week, find the
// Thursday of Jan 4 (week 1 anchor), divide the day-delta by 7.
export function isoWeekNumber(date: Date): number {
  // Use a UTC copy to avoid DST jumps perturbing the day arithmetic.
  // `Sun = 0` becomes `7` so the "Thursday of this week" offset is
  // computed correctly regardless of the input weekday.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

// Anchor Monday for the given date. Used by the W-column so the
// per-row week-number cell clicks land on the correct ISO week even
// when the calendar's week-start setting is Sunday (the leftmost cell
// in the row is then a SUNDAY, but the ISO week is keyed on the
// MONDAY that follows it).
export function mondayOfIsoWeek(date: Date): Date {
  // Build a fresh local-time date so callers can pass any Date.
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // JS getDay: 0=Sunday..6=Saturday. ISO Monday is the (day - 1 + 7) % 7
  // step backward; Sunday (0) maps to 6 steps back.
  const dayNum = d.getDay()
  const offset = dayNum === 0 ? -6 : 1 - dayNum
  d.setDate(d.getDate() + offset)
  return d
}
