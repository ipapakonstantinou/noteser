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
