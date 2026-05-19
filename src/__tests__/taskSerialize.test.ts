/**
 * taskSerialize.test.ts
 *
 * Tests for serializeTaskLine (and priorityToEmoji) plus a round-trip
 * verification with parseTaskMetadata. The canonical marker ordering
 * established here matches the fixture used in tasks.test.ts (priority,
 * due, scheduled, start, done).
 */

import {
  serializeTaskLine,
  parseTaskMetadata,
  priorityToEmoji,
  UI_TASK_LINE_REGEX,
  type TaskLineParts,
  type TaskPriority,
} from '../utils/tasks'

// Helper: parse the body part of a task line (everything after `- [ ] `
// or `- [x] `) and return the structured parts. Used to round-trip-test
// serialised lines without exposing the bullet/checkbox in the assertion.
function partsFromLine(line: string): { open: boolean; body: string } | null {
  const m = line.match(UI_TASK_LINE_REGEX)
  if (!m) return null
  const [, , mark, , rest] = m
  return { open: mark.toLowerCase() !== 'x', body: rest }
}

describe('priorityToEmoji', () => {
  test('maps each priority to the right emoji', () => {
    expect(priorityToEmoji('highest')).toBe('⏫')
    expect(priorityToEmoji('high')).toBe('🔼')
    expect(priorityToEmoji('low')).toBe('🔽')
    expect(priorityToEmoji('lowest')).toBe('⏬')
  })

  test('normal has no emoji marker (returns null)', () => {
    expect(priorityToEmoji('normal')).toBeNull()
  })
})

describe('serializeTaskLine', () => {
  test('default bullet is "- " for open tasks with text only', () => {
    const out = serializeTaskLine({
      open: true,
      text: 'buy milk',
      priority: 'normal',
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      completedDate: null,
    })
    expect(out).toBe('- [ ] buy milk')
  })

  test('closed task uses [x] marker', () => {
    const out = serializeTaskLine({
      open: false,
      text: 'shipped',
      priority: 'normal',
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      completedDate: null,
    })
    expect(out).toBe('- [x] shipped')
  })

  test('serialises all fields in canonical order: priority, due, scheduled, start, done', () => {
    const parts: TaskLineParts = {
      open: false,
      text: 'big thing',
      priority: 'highest',
      dueDate: '2026-05-20',
      scheduledDate: '2026-05-19',
      startDate: '2026-05-18',
      completedDate: '2026-05-21',
    }
    const out = serializeTaskLine(parts)
    expect(out).toBe('- [x] big thing ⏫ 📅 2026-05-20 ⏳ 2026-05-19 🛫 2026-05-18 ✅ 2026-05-21')
  })

  test('omits markers for null fields', () => {
    const out = serializeTaskLine({
      open: true,
      text: 'thing',
      priority: 'high',
      dueDate: '2026-05-20',
      scheduledDate: null,
      startDate: null,
      completedDate: null,
    })
    expect(out).toBe('- [ ] thing 🔼 📅 2026-05-20')
    expect(out).not.toContain('⏳')
    expect(out).not.toContain('🛫')
    expect(out).not.toContain('✅')
  })

  test('normal priority emits no marker even when other markers are present', () => {
    const out = serializeTaskLine({
      open: true,
      text: 'just due',
      priority: 'normal',
      dueDate: '2026-05-20',
      scheduledDate: null,
      startDate: null,
      completedDate: null,
    })
    expect(out).toBe('- [ ] just due 📅 2026-05-20')
    // No priority emoji at all
    expect(out).not.toMatch(/⏫|🔼|🔽|⏬/)
  })

  test('honours a custom bullet prefix (e.g. "* ")', () => {
    const out = serializeTaskLine(
      {
        open: true,
        text: 'star',
        priority: 'normal',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
      },
      '* ',
    )
    expect(out).toBe('* [ ] star')
  })

  test('honours an indented bullet ("  - ")', () => {
    const out = serializeTaskLine(
      {
        open: true,
        text: 'nested',
        priority: 'normal',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
      },
      '  - ',
    )
    expect(out).toBe('  - [ ] nested')
  })

  test('honours a numbered-list bullet ("1. ")', () => {
    const out = serializeTaskLine(
      {
        open: false,
        text: 'first',
        priority: 'normal',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
      },
      '1. ',
    )
    expect(out).toBe('1. [x] first')
  })

  test('empty text still produces a syntactically-valid task line', () => {
    const out = serializeTaskLine({
      open: true,
      text: '',
      priority: 'normal',
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      completedDate: null,
    })
    // The UI regex requires `\]\s+` so we always emit at least one space
    // after the bracket. With no body, the result is `- [ ] `.
    expect(out).toBe('- [ ] ')
    expect(UI_TASK_LINE_REGEX.test(out)).toBe(true)
  })

  test('whitespace in text is trimmed by the serialiser', () => {
    const out = serializeTaskLine({
      open: true,
      text: '   spaced  ',
      priority: 'normal',
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      completedDate: null,
    })
    expect(out).toBe('- [ ] spaced')
  })
})

describe('serializeTaskLine ↔ parseTaskMetadata round-trip', () => {
  test('all-fields round-trip preserves every part', () => {
    const original: TaskLineParts = {
      open: false,
      text: 'write report',
      priority: 'highest',
      dueDate: '2026-05-20',
      scheduledDate: '2026-05-19',
      startDate: '2026-05-18',
      completedDate: '2026-05-21',
    }
    const line = serializeTaskLine(original)
    const stripped = partsFromLine(line)
    expect(stripped).not.toBeNull()
    const parsed = parseTaskMetadata(stripped!.body)
    expect(stripped!.open).toBe(original.open)
    expect(parsed.text).toBe(original.text)
    expect(parsed.priority).toBe(original.priority)
    expect(parsed.dueDate).toBe(original.dueDate)
    expect(parsed.scheduledDate).toBe(original.scheduledDate)
    expect(parsed.startDate).toBe(original.startDate)
    expect(parsed.completedDate).toBe(original.completedDate)
  })

  test('only-text round-trips (no metadata)', () => {
    const original: TaskLineParts = {
      open: true,
      text: 'plain task',
      priority: 'normal',
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      completedDate: null,
    }
    const line = serializeTaskLine(original)
    expect(line).toBe('- [ ] plain task')
    const stripped = partsFromLine(line)!
    const parsed = parseTaskMetadata(stripped.body)
    expect(stripped.open).toBe(true)
    expect(parsed.text).toBe('plain task')
    expect(parsed.priority).toBe('normal')
    expect(parsed.dueDate).toBeNull()
    expect(parsed.scheduledDate).toBeNull()
    expect(parsed.startDate).toBeNull()
    expect(parsed.completedDate).toBeNull()
  })

  test('completed task with ✅ date round-trips', () => {
    const original: TaskLineParts = {
      open: false,
      text: 'shipped feature',
      priority: 'normal',
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      completedDate: '2026-05-21',
    }
    const line = serializeTaskLine(original)
    expect(line).toBe('- [x] shipped feature ✅ 2026-05-21')
    const stripped = partsFromLine(line)!
    const parsed = parseTaskMetadata(stripped.body)
    expect(stripped.open).toBe(false)
    expect(parsed.text).toBe('shipped feature')
    expect(parsed.completedDate).toBe('2026-05-21')
  })

  test('each priority level round-trips on its own', () => {
    const priorities: TaskPriority[] = ['highest', 'high', 'normal', 'low', 'lowest']
    for (const p of priorities) {
      const line = serializeTaskLine({
        open: true,
        text: 'thing',
        priority: p,
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
      })
      const stripped = partsFromLine(line)!
      const parsed = parseTaskMetadata(stripped.body)
      expect(parsed.priority).toBe(p)
    }
  })

  test('default bullet "- " round-trips even with indented input bullet', () => {
    // Default bullet ALWAYS produces `- ` — we don't try to round-trip the
    // bullet itself, only the body parts. This documents that behaviour.
    const original: TaskLineParts = {
      open: true,
      text: 'thing',
      priority: 'high',
      dueDate: '2026-01-01',
      scheduledDate: null,
      startDate: null,
      completedDate: null,
    }
    const out = serializeTaskLine(original)
    expect(out.startsWith('- ')).toBe(true)
  })
})
