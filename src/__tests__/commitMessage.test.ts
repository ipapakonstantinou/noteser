/**
 * commitMessage.test.ts
 *
 * Covers utils/commitMessage.ts — the {{date}} expansion for the Source
 * Control commit-message template (#176). The contract: every {{date}}
 * occurrence resolves to today's LOCAL YYYY-MM-DD using the same formatter
 * as daily-note titles (utils/dateFormat), so the SCM box never shows the
 * literal placeholder and the date never drifts a day via UTC conversion.
 */

import { expandCommitMessage } from '@/utils/commitMessage'
import { formatDate } from '@/utils/dateFormat'

describe('expandCommitMessage', () => {
  test('substitutes {{date}} with the given date as YYYY-MM-DD', () => {
    // Local-constructed date → expectation holds in any timezone.
    const now = new Date(2026, 5, 10) // June 10, 2026
    expect(expandCommitMessage('Sync from Noteser ({{date}})', now)).toBe(
      'Sync from Noteser (2026-06-10)',
    )
  })

  test('replaces EVERY occurrence, not just the first', () => {
    const now = new Date(2026, 0, 2)
    expect(expandCommitMessage('{{date}} backup {{date}}', now)).toBe(
      '2026-01-02 backup 2026-01-02',
    )
  })

  test('messages without the token pass through verbatim', () => {
    expect(expandCommitMessage('plain message')).toBe('plain message')
    expect(expandCommitMessage('')).toBe('')
  })

  test('unknown tokens are left untouched (future-extensible)', () => {
    const now = new Date(2026, 5, 10)
    expect(expandCommitMessage('{{date}} — {{count}} notes', now)).toBe(
      '2026-06-10 — {{count}} notes',
    )
  })

  test('uses the daily-note formatter (LOCAL date), matching formatDate exactly', () => {
    // Late-evening local time: a UTC-based implementation (toISOString)
    // would disagree with the local date in any non-UTC timezone. Locking
    // the output to formatDate(now, 'YYYY-MM-DD') pins the daily-notes
    // semantics regardless of the timezone the test runs in.
    const now = new Date(2026, 11, 31, 23, 30)
    expect(expandCommitMessage('{{date}}', now)).toBe(formatDate(now, 'YYYY-MM-DD'))
    expect(expandCommitMessage('{{date}}', now)).toBe('2026-12-31')
  })

  test('defaults to the current date when no explicit now is passed', () => {
    const today = formatDate(new Date(), 'YYYY-MM-DD')
    expect(expandCommitMessage('Sync ({{date}})')).toBe(`Sync (${today})`)
  })
})
