// Daily-note streak counter.
//
// Given a set of note titles + the user's dailyNoteDateFormat, count
// the number of CONSECUTIVE days (anchored on a reference date,
// usually "today") that the user has a daily note for. The streak
// includes the reference day if a note exists for it; otherwise it
// starts from yesterday. Skips any non-parseable titles.

import { formatDate } from './dateFormat'

export interface StreakResult {
  /** Number of consecutive days with a daily note, ending at the
   *  most recent qualifying day. 0 when no recent daily notes. */
  length: number
  /** Wall-clock date of the most recent day in the streak (UTC
   *  midnight). Useful for showing "since Monday". null when
   *  length === 0. */
  endDate: Date | null
  /** True when the streak includes the reference day. */
  includesToday: boolean
}

// Compute the streak length given a Set of date strings (in the
// user's dailyNoteDateFormat). Pure — caller does the formatting
// and filtering of active (non-deleted) notes. Reference date
// defaults to `now`; pass an explicit value for tests.
export function computeStreakFromDateStrings(
  dateStringSet: Set<string>,
  format: string,
  now = new Date(),
): StreakResult {
  // Walk backwards from `now`, day by day, counting until we miss
  // one. If today is missing we start from yesterday — a streak that
  // ended yesterday still counts (UX: "the user kept it up through
  // yesterday, today is in progress").
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)

  const todayStr = formatDate(cursor, format)
  const includesToday = dateStringSet.has(todayStr)
  if (!includesToday) {
    // Slide cursor back to yesterday before we start counting.
    cursor.setDate(cursor.getDate() - 1)
    if (!dateStringSet.has(formatDate(cursor, format))) {
      return { length: 0, endDate: null, includesToday: false }
    }
  }

  let length = 0
  const endDate = new Date(cursor)
  // Cap at a year — should never realistically run that long, but
  // a corrupt set with self-loops shouldn't hang the UI.
  for (let i = 0; i < 366; i++) {
    if (dateStringSet.has(formatDate(cursor, format))) {
      length++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return { length, endDate, includesToday }
}

// Helper used by the UI hook — builds the date-string Set from the
// note store. `titles` is just the title of each active note.
export function dailyDateSet(titles: string[], format: string): Set<string> {
  const out = new Set<string>()
  for (const title of titles) {
    if (!title) continue
    // We don't try to parse the title — if the user's daily-note
    // template put extra text in the filename ("2026-05-20 — Mon"),
    // the Set lookup just won't match. That's fine; the user's
    // dailyNoteDateFormat controls the canonical name.
    out.add(title)
  }
  // Re-test: only entries that round-trip through formatDate at SOME
  // date in the last year stay. This is a defensive filter so a
  // bunch of random non-date titles don't blow up the Set or pollute
  // the streak.
  const filtered = new Set<string>()
  const ref = new Date()
  ref.setHours(0, 0, 0, 0)
  for (let i = 0; i < 800; i++) {
    const t = new Date(ref)
    t.setDate(ref.getDate() - i)
    const formatted = formatDate(t, format)
    if (out.has(formatted)) filtered.add(formatted)
  }
  return filtered
}
