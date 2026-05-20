/**
 * weeklyReview.test.ts
 *
 * Pure-helper coverage. Reference "now" is fixed so test runs are
 * deterministic regardless of system clock.
 */

import {
  buildWeeklyReview,
  weeklyWindowStart,
  type WeeklyReviewNote,
} from '../utils/weeklyReview'

const NOW = new Date('2026-05-20T12:00:00')
const ONE_DAY = 24 * 60 * 60 * 1000

const note = (overrides: Partial<WeeklyReviewNote> & { id: string }): WeeklyReviewNote => ({
  title: 'Untitled',
  content: '',
  updatedAt: NOW.getTime(),
  isDeleted: false,
  ...overrides,
})

test('empty input produces "no activity" body', () => {
  const r = buildWeeklyReview([], NOW)
  expect(r.notesTouched).toBe(0)
  expect(r.body).toContain('No activity this week')
})

test('window cutoff is 7 days back (rolling) by default', () => {
  const start = weeklyWindowStart(NOW)
  // 7 days earlier, snapped to start-of-day.
  expect(start.getTime()).toBe(new Date('2026-05-13T00:00:00').getTime())
})

test('weekStartsOnMonday snaps to nearest Monday', () => {
  // 2026-05-20 is a Wednesday. Monday before = 2026-05-18.
  const start = weeklyWindowStart(NOW, true)
  expect(start.getTime()).toBe(new Date('2026-05-18T00:00:00').getTime())
})

test('drops notes older than the window', () => {
  const r = buildWeeklyReview(
    [
      note({ id: 'a', title: 'Recent', updatedAt: NOW.getTime() - ONE_DAY }),
      note({ id: 'b', title: 'Ancient', updatedAt: NOW.getTime() - 30 * ONE_DAY }),
    ],
    NOW,
  )
  expect(r.notesTouched).toBe(1)
  expect(r.body).toContain('Recent')
  expect(r.body).not.toContain('Ancient')
})

test('drops deleted notes even if recent', () => {
  const r = buildWeeklyReview(
    [
      note({ id: 'a', title: 'Live', updatedAt: NOW.getTime() }),
      note({ id: 'b', title: 'Trashed', updatedAt: NOW.getTime(), isDeleted: true }),
    ],
    NOW,
  )
  expect(r.notesTouched).toBe(1)
  expect(r.body).toContain('Live')
  expect(r.body).not.toContain('Trashed')
})

test('parses open and done tasks separately', () => {
  const content = [
    '- [ ] Ship the weekly review',
    '- [x] Write tests',
    '* [ ] Star bullet open',
    '* [X] Star bullet done',
    'Some other line',
  ].join('\n')
  const r = buildWeeklyReview(
    [note({ id: 'a', title: 'Sprint', content, updatedAt: NOW.getTime() })],
    NOW,
  )
  expect(r.openTaskCount).toBe(2)
  expect(r.doneTaskCount).toBe(2)
  expect(r.body).toContain('Ship the weekly review')
  expect(r.body).toContain('Star bullet open')
  expect(r.body).toContain('Write tests')
  expect(r.body).toContain('Star bullet done')
})

test('deduplicates identical task text across notes', () => {
  const content = '- [ ] follow up with ops'
  const r = buildWeeklyReview(
    [
      note({ id: 'a', title: 'Mon', content, updatedAt: NOW.getTime() - ONE_DAY }),
      note({ id: 'b', title: 'Tue', content, updatedAt: NOW.getTime() }),
    ],
    NOW,
  )
  expect(r.openTaskCount).toBe(1)
  // Each task line is annotated with its source — the first occurrence
  // (sorted by updatedAt desc) wins.
  expect(r.body).toContain('_(from Tue)_')
  expect(r.body).not.toContain('_(from Mon)_')
})

test('aggregates and ranks tags by frequency', () => {
  const r = buildWeeklyReview(
    [
      note({ id: 'a', title: 'A', content: '#work #ops #work', updatedAt: NOW.getTime() }),
      note({ id: 'b', title: 'B', content: '#work #personal', updatedAt: NOW.getTime() - ONE_DAY }),
    ],
    NOW,
  )
  expect(r.tagCount).toBe(3)
  // #work is most frequent → appears first in the rendered line.
  const tagLine = r.body.split('\n').find(l => l.includes('`#work`')) ?? ''
  // The "(2)" we'd write next to #work because extractTags dedupes per
  // note: A contributes 1, B contributes 1 → total 2 notes mentioning #work.
  expect(tagLine).toMatch(/`#work`\s*\(2\)/)
  // #work appears before #ops/#personal in the line.
  expect(tagLine.indexOf('#work')).toBeLessThan(tagLine.indexOf('#ops'))
})

test('cap on open tasks does not exceed 100', () => {
  const lines: string[] = []
  for (let i = 0; i < 250; i++) lines.push(`- [ ] task ${i}`)
  const r = buildWeeklyReview(
    [note({ id: 'a', title: 'Mega', content: lines.join('\n'), updatedAt: NOW.getTime() })],
    NOW,
  )
  expect(r.openTaskCount).toBe(100)
})

test('body lists notes touched as wikilinks', () => {
  const r = buildWeeklyReview(
    [note({ id: 'a', title: 'Project alpha', updatedAt: NOW.getTime() })],
    NOW,
  )
  expect(r.body).toContain('[[Project alpha]]')
})

test('window boundary is inclusive — exact-cutoff note still counts', () => {
  const cutoff = weeklyWindowStart(NOW).getTime()
  const r = buildWeeklyReview(
    [note({ id: 'a', title: 'EdgeCase', updatedAt: cutoff })],
    NOW,
  )
  expect(r.notesTouched).toBe(1)
})
