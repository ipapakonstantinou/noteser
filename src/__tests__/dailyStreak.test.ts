/**
 * dailyStreak.test.ts
 *
 * Pure-helper tests for the daily-note streak counter. Uses a fixed
 * reference date so test runs are deterministic.
 */

import { computeStreakFromDateStrings, dailyDateSet } from '../utils/dailyStreak'

const FMT = 'YYYY-MM-DD'

function set(...dates: string[]): Set<string> {
  return new Set(dates)
}

test('empty set → length 0', () => {
  const result = computeStreakFromDateStrings(new Set(), FMT, new Date('2026-05-20T12:00:00'))
  expect(result.length).toBe(0)
  expect(result.includesToday).toBe(false)
})

test('today only → length 1, includesToday true', () => {
  const result = computeStreakFromDateStrings(
    set('2026-05-20'),
    FMT,
    new Date('2026-05-20T12:00:00'),
  )
  expect(result.length).toBe(1)
  expect(result.includesToday).toBe(true)
})

test('today + yesterday + day-before → length 3', () => {
  const result = computeStreakFromDateStrings(
    set('2026-05-20', '2026-05-19', '2026-05-18'),
    FMT,
    new Date('2026-05-20T12:00:00'),
  )
  expect(result.length).toBe(3)
})

test('today missing but yesterday + earlier present → streak includes yesterday', () => {
  // "User hasn't written today's note yet but kept the streak alive
  // through yesterday." includesToday is false; length still counts.
  const result = computeStreakFromDateStrings(
    set('2026-05-19', '2026-05-18', '2026-05-17'),
    FMT,
    new Date('2026-05-20T12:00:00'),
  )
  expect(result.length).toBe(3)
  expect(result.includesToday).toBe(false)
})

test('a gap breaks the streak — only consecutive days from the end count', () => {
  // Yesterday + 2 days ago present but 3 days ago missing.
  const result = computeStreakFromDateStrings(
    set('2026-05-19', '2026-05-18', '2026-05-15'),
    FMT,
    new Date('2026-05-20T12:00:00'),
  )
  expect(result.length).toBe(2)
})

test('today missing AND yesterday missing → length 0', () => {
  const result = computeStreakFromDateStrings(
    set('2026-05-15', '2026-05-14'),
    FMT,
    new Date('2026-05-20T12:00:00'),
  )
  expect(result.length).toBe(0)
})

test('dailyDateSet filters non-matching titles', () => {
  const out = dailyDateSet(
    ['2026-05-20', 'Some random note', '2026-05-19', '!!!'],
    FMT,
  )
  // Both daily-shaped titles MUST be in the set; non-matching ones
  // are silently dropped.
  expect(out.has('2026-05-20')).toBe(true)
  expect(out.has('2026-05-19')).toBe(true)
  expect(out.has('Some random note')).toBe(false)
})

test('streak caps at 366 days (defensive)', () => {
  // Pathological input — every day in the last 2 years. The cap
  // means we still terminate quickly.
  const dates = new Set<string>()
  const now = new Date('2026-05-20T12:00:00')
  for (let i = 0; i < 800; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const result = computeStreakFromDateStrings(dates, FMT, now)
  expect(result.length).toBeLessThanOrEqual(366)
  expect(result.length).toBeGreaterThan(300)
})
