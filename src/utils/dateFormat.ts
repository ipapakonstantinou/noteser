// Tiny date formatter for the daily-note title format setting. Supports
// the moment-style tokens users typically reach for:
//
//   YYYY  4-digit year (2026)
//   YY    2-digit year (26)
//   MMMM  full month name (May)
//   MMM   abbreviated month (May)
//   MM    2-digit month (05)
//   M     month, no leading zero (5)
//   DD    2-digit day (19)
//   D     day, no leading zero (19)
//   dddd  full weekday (Tuesday)
//   ddd   abbreviated weekday (Tue)
//   WW    2-digit ISO week (01..53)
//   W     ISO week, no leading zero (1..53)
//   Q     quarter (1..4)
//
// Tokens are matched longest-first so MMMM wins over MMM, MMM over MM,
// MM over M, WW over W. Unrecognised characters pass through verbatim, so users
// can freely interleave separators and literal text. We avoid a dep like
// date-fns or dayjs — this is a few lines and zero footprint.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3))
const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]
const WEEKDAYS_SHORT = WEEKDAYS.map(d => d.slice(0, 3))

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// Single regex captures every supported token in one pass, longest
// alternative first so the lexer doesn't bail on a shorter prefix.
// `[...]` escapes a literal, the moment.js/Obsidian convention: "YYYY-[W]WW" -> "2026-W30".
// It has to lead the alternation so the lexer swallows the whole bracket group before it
// can see the tokens inside — otherwise the W in [W] is read as the week number.
const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|WW|W|Q/g

// ISO 8601 week number — Thursday of the current week determines the
// year-week pair. Weeks start on Monday. Returns 1..53.
function isoWeek(d: Date): number {
  // Copy to avoid mutating the caller's date.
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // Shift to the Thursday of the current ISO week.
  const dayNum = (t.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const diff = (t.getTime() - firstThursday.getTime()) / 86400000
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
}

export function formatDate(date: Date, format: string): string {
  const year = date.getFullYear()
  const month0 = date.getMonth() // 0-based
  const day = date.getDate()
  const weekday = date.getDay() // 0 = Sunday
  const week = isoWeek(date)
  const quarter = Math.floor(month0 / 3) + 1

  return format.replace(TOKEN_RE, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal // bracketed text passes through verbatim
    switch (token) {
      case 'YYYY': return String(year)
      case 'YY':   return String(year).slice(-2)
      case 'MMMM': return MONTHS[month0]
      case 'MMM':  return MONTHS_SHORT[month0]
      case 'MM':   return pad(month0 + 1)
      case 'M':    return String(month0 + 1)
      case 'DD':   return pad(day)
      case 'D':    return String(day)
      case 'dddd': return WEEKDAYS[weekday]
      case 'ddd':  return WEEKDAYS_SHORT[weekday]
      case 'WW':   return pad(week)
      case 'W':    return String(week)
      case 'Q':    return String(quarter)
      default:     return token
    }
  })
}
