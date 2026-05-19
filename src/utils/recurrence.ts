// Recurrence helpers for Obsidian-Tasks-style `🔁 every <unit>` rules.
//
// Supported grammar (case-insensitive):
//   every day
//   every week
//   every month
//   every year
//   every <N> <unit>[s]               e.g. "every 2 weeks", "every 3 days"
//   every month on the <N>[st|nd|rd|th]  e.g. "every month on the 1st"
//   <any of the above> when done       suffix handled by the caller (toggle)
//
// All math is in UTC to avoid timezone / DST surprises — these dates are
// calendar dates, not wall-clock instants.

const RULE_REGEX = /^every\s+(?:(\d+)\s+)?(day|week|month|year)s?(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:\s+when\s+done)?$/i

interface ParsedRule {
  count: number
  unit: 'day' | 'week' | 'month' | 'year'
  onDay: number | null
}

function parseRule(rrule: string): ParsedRule | null {
  // Strip variant-selector + zero-width characters that emoji pickers leak
  // into the rule string. Without this, a literal "🔁️ every week" produces
  // a rule with a leading U+FE0F (variant selector) which the strict
  // grammar below would reject. See RECURRENCE_REGEX in tasks.ts.
  //   U+FE00–U+FE0F : Variation Selectors (incl. VS16 = emoji style)
  //   U+200B–U+200D : zero-width space / non-joiner / joiner
  //   U+FEFF        : BOM / zero-width no-break space
  const cleaned = rrule.replace(/[︀-️​-‍﻿]/g, '')
  const norm = cleaned.trim().toLowerCase().replace(/\s+/g, ' ')
  const m = RULE_REGEX.exec(norm)
  if (!m) return null
  const count = m[1] ? parseInt(m[1], 10) : 1
  if (!Number.isFinite(count) || count <= 0) return null
  const unit = m[2] as ParsedRule['unit']
  const onDay = m[3] ? parseInt(m[3], 10) : null
  if (onDay != null && (onDay < 1 || onDay > 31)) return null
  return { count, unit, onDay }
}

// Parse an ISO YYYY-MM-DD into a UTC Date.
function fromISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  return new Date(Date.UTC(y, mo - 1, d))
}

function toISO(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Add `count` <unit>s to `date`, clamping the day-of-month to the destination
// month's last day when needed (e.g. Jan 31 + 1 month → Feb 28/29).
function addPeriod(date: Date, count: number, unit: ParsedRule['unit']): Date {
  const next = new Date(date.getTime())
  switch (unit) {
    case 'day':
      next.setUTCDate(next.getUTCDate() + count)
      return next
    case 'week':
      next.setUTCDate(next.getUTCDate() + 7 * count)
      return next
    case 'month': {
      const targetDay = next.getUTCDate()
      next.setUTCDate(1)
      next.setUTCMonth(next.getUTCMonth() + count)
      const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
      next.setUTCDate(Math.min(targetDay, lastDay))
      return next
    }
    case 'year': {
      const targetMonth = next.getUTCMonth()
      const targetDay = next.getUTCDate()
      next.setUTCDate(1)
      next.setUTCFullYear(next.getUTCFullYear() + count)
      next.setUTCMonth(targetMonth)
      const lastDay = new Date(Date.UTC(next.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate()
      next.setUTCDate(Math.min(targetDay, lastDay))
      return next
    }
  }
}

// Compute the next instance ISO date for a recurrence rule, anchored on
// `anchorISO`. Returns null when the rule is unparseable or the anchor is
// malformed.
export function nextRecurrence(rrule: string, anchorISO: string): string | null {
  const parsed = parseRule(rrule)
  if (!parsed) return null
  const anchor = fromISO(anchorISO)
  if (!anchor) return null

  if (parsed.unit === 'month' && parsed.onDay != null) {
    // Pin to the requested day-of-month after stepping forward by `count`
    // months. If that day doesn't exist in the destination month (e.g. 31st
    // of February), clamp to the month's last day.
    const next = new Date(anchor.getTime())
    next.setUTCDate(1)
    next.setUTCMonth(next.getUTCMonth() + parsed.count)
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
    next.setUTCDate(Math.min(parsed.onDay, lastDay))
    return toISO(next)
  }

  return toISO(addPeriod(anchor, parsed.count, parsed.unit))
}

// Shift an ISO date by `days` (signed). Returns null on malformed input —
// callers fall back to the original date.
export function shiftISOByDays(iso: string, days: number): string | null {
  const d = fromISO(iso)
  if (!d) return null
  d.setUTCDate(d.getUTCDate() + days)
  return toISO(d)
}

// Whole-day difference between two ISO dates. `to - from`, so a result of 7
// means `to` is one week after `from`. Returns 0 for malformed inputs (the
// safe fallback — no shift).
export function isoDiffDays(fromISOStr: string, toISOStr: string): number {
  const a = fromISO(fromISOStr)
  const b = fromISO(toISOStr)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

// Does the given rule parse as a valid recurrence? Exposed for UI validation
// (e.g. red-outline the TaskEditModal field when the user types nonsense).
export function isValidRecurrence(rrule: string): boolean {
  return parseRule(rrule) != null
}
