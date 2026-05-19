/**
 * tasks.test.ts
 *
 * Unit tests for src/utils/tasks.ts — pure functions, no mocks needed.
 */

import { extractTasks, todayISO, toggleTaskLine, toggleTaskLineText, removeTaskPrefixFromLine, parseTaskMetadata, Task, TaskSourceNote } from '../utils/tasks'

// ── extractTasks ──────────────────────────────────────────────────────────────

describe('extractTasks', () => {
  test('empty array returns []', () => {
    expect(extractTasks([])).toEqual([])
  })

  test('notes with isDeleted: true are skipped', () => {
    const notes: TaskSourceNote[] = [
      { id: 'a', content: '- [ ] visible task' },
      { id: 'b', content: '- [ ] deleted task', isDeleted: true },
    ]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].noteId).toBe('a')
  })

  test('notes with undefined content are skipped without error', () => {
    const notes: TaskSourceNote[] = [
      { id: 'a' },                    // no content field
      { id: 'b', content: undefined }, // explicit undefined
    ]
    expect(extractTasks(notes)).toEqual([])
  })

  test('notes with empty string content are skipped', () => {
    const notes: TaskSourceNote[] = [{ id: 'a', content: '' }]
    expect(extractTasks(notes)).toEqual([])
  })

  test('single open task: completed=false, completedDate=null, lineNumber=0, text=body', () => {
    const notes: TaskSourceNote[] = [{ id: 'n1', content: '- [ ] foo' }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toEqual<Task>({
      noteId: 'n1',
      lineNumber: 0,
      text: 'foo',
      completed: false,
      completedDate: null,
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      priority: 'normal',
      recurrence: null,
    })
  })

  test('lowercase [x] → completed=true, completedDate=null', () => {
    const notes: TaskSourceNote[] = [{ id: 'n1', content: '- [x] done' }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].completed).toBe(true)
    expect(tasks[0].completedDate).toBeNull()
    expect(tasks[0].text).toBe('done')
  })

  test('uppercase [X] → completed=true', () => {
    const notes: TaskSourceNote[] = [{ id: 'n1', content: '- [X] Done uppercase' }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].completed).toBe(true)
  })

  test('closed task with ✅ date suffix: completedDate extracted, suffix stripped from text', () => {
    const notes: TaskSourceNote[] = [{ id: 'n1', content: '- [x] thing I did ✅ 2026-01-15' }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].completedDate).toBe('2026-01-15')
    expect(tasks[0].text).toBe('thing I did')
    // No trailing whitespace in stripped text
    expect(tasks[0].text).toBe(tasks[0].text.trimEnd())
  })

  test('indented task (spaces before -) is matched', () => {
    const notes: TaskSourceNote[] = [{ id: 'n1', content: '  - [ ] indented' }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].text).toBe('indented')
  })

  test('non-task lines are not extracted', () => {
    const lines = [
      'foo',
      '- not a task',
      '-[ ] missing space before bracket',
      '* [ ] wrong bullet',
    ]
    const notes: TaskSourceNote[] = [{ id: 'n1', content: lines.join('\n') }]
    expect(extractTasks(notes)).toEqual([])
  })

  test('"- [ ]" with NO trailing whitespace does NOT match (regex requires \\]\\s+)', () => {
    const notes: TaskSourceNote[] = [{ id: 'n1', content: '- [ ]' }]
    expect(extractTasks(notes)).toEqual([])
  })

  test('task on line 3 of a multi-line note has lineNumber === 2 (0-based)', () => {
    const content = 'first line\nsecond line\n- [ ] third'
    const notes: TaskSourceNote[] = [{ id: 'n1', content }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].lineNumber).toBe(2)
  })

  test('multi-line note with multiple tasks: returned in source order with correct lineNumbers', () => {
    const content = '- [ ] alpha\nsome prose\n- [x] beta\n- [ ] gamma'
    const notes: TaskSourceNote[] = [{ id: 'n1', content }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toMatchObject({ lineNumber: 0, text: 'alpha', completed: false })
    expect(tasks[1]).toMatchObject({ lineNumber: 2, text: 'beta',  completed: true  })
    expect(tasks[2]).toMatchObject({ lineNumber: 3, text: 'gamma', completed: false })
  })

  test('CRLF line endings are handled correctly (splits on /\\r?\\n/)', () => {
    const content = '- [ ] first\r\n- [x] second'
    const notes: TaskSourceNote[] = [{ id: 'n1', content }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({ lineNumber: 0, text: 'first',  completed: false })
    expect(tasks[1]).toMatchObject({ lineNumber: 1, text: 'second', completed: true  })
  })

  test('tasks from multiple notes preserve their respective noteIds', () => {
    const notes: TaskSourceNote[] = [
      { id: 'note-1', content: '- [ ] from first note' },
      { id: 'note-2', content: '- [x] from second note' },
    ]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].noteId).toBe('note-1')
    expect(tasks[1].noteId).toBe('note-2')
  })

  test('tasks from multiple notes are returned in note order', () => {
    const notes: TaskSourceNote[] = [
      { id: 'a', content: '- [ ] task A' },
      { id: 'b', content: '- [ ] task B' },
      { id: 'c', content: '- [ ] task C' },
    ]
    const tasks = extractTasks(notes)
    expect(tasks.map(t => t.noteId)).toEqual(['a', 'b', 'c'])
  })

  test('edge case: "- [ ] " (trailing space, empty body) matches and produces text=""', () => {
    // The regex requires \]\s+ (one or more whitespace after ]), so the trailing
    // space after ] satisfies that and .* captures an empty string as the body.
    const notes: TaskSourceNote[] = [{ id: 'n1', content: '- [ ] ' }]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].text).toBe('')
    expect(tasks[0].completed).toBe(false)
  })
})

// ── todayISO ──────────────────────────────────────────────────────────────────

describe('todayISO', () => {
  test('returns a 10-character string in YYYY-MM-DD format', () => {
    const result = todayISO(new Date())
    expect(result).toHaveLength(10)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('returns correct date for a fixed Date (May 18 2026)', () => {
    // Month is 0-indexed in Date constructor: 4 = May
    expect(todayISO(new Date(2026, 4, 18, 10, 30))).toBe('2026-05-18')
  })

  test('pads single-digit month with leading zero', () => {
    // Month 0 = January
    expect(todayISO(new Date(2026, 0, 15))).toBe('2026-01-15')
  })

  test('pads single-digit day with leading zero', () => {
    // Day 5 of February (month index 1)
    expect(todayISO(new Date(2026, 1, 5))).toBe('2026-02-05')
  })

  test('pads both single-digit month and day', () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  test('works for last day of year (December 31)', () => {
    expect(todayISO(new Date(2025, 11, 31))).toBe('2025-12-31')
  })
})

// ── toggleTaskLine ────────────────────────────────────────────────────────────

// Fixed date used throughout toggleTaskLine tests to make assertions deterministic.
const FIXED_DATE = new Date(2026, 4, 18) // 2026-05-18

describe('toggleTaskLine', () => {
  test('checking an open task appends ✅ date stamp', () => {
    const content = '- [ ] foo'
    const result = toggleTaskLine(content, 0, FIXED_DATE)
    expect(result).toBe('- [x] foo ✅ 2026-05-18')
  })

  test('checking an open task that already has a ✅ date in body keeps existing date', () => {
    // Unusual but defensible: the task body itself contains a date stamp even
    // though the mark is [ ]. The code detects the date in `rest` and does NOT
    // append another one — it only flips the mark.
    const content = '- [ ] foo ✅ 2026-01-15'
    const result = toggleTaskLine(content, 0, FIXED_DATE)
    expect(result).toBe('- [x] foo ✅ 2026-01-15')
  })

  test('unchecking a closed task with ✅ date strips the date', () => {
    const content = '- [x] foo ✅ 2026-01-15'
    const result = toggleTaskLine(content, 0, FIXED_DATE)
    expect(result).toBe('- [ ] foo')
  })

  test('unchecking a closed task with no date just flips the mark', () => {
    const content = '- [x] bar'
    const result = toggleTaskLine(content, 0, FIXED_DATE)
    expect(result).toBe('- [ ] bar')
  })

  test('unchecking uppercase [X] works the same as lowercase [x]', () => {
    const content = '- [X] uppercase'
    const result = toggleTaskLine(content, 0, FIXED_DATE)
    expect(result).toBe('- [ ] uppercase')
  })

  test('negative lineNumber returns content unchanged', () => {
    const content = '- [ ] foo'
    expect(toggleTaskLine(content, -1, FIXED_DATE)).toBe(content)
  })

  test('lineNumber equal to line count (out of range) returns content unchanged', () => {
    const content = '- [ ] foo'
    // content has 1 line; index 1 is out of range
    expect(toggleTaskLine(content, 1, FIXED_DATE)).toBe(content)
  })

  test('lineNumber beyond last line returns content unchanged', () => {
    const content = 'line1\nline2'
    expect(toggleTaskLine(content, 99, FIXED_DATE)).toBe(content)
  })

  test('line that is not a task returns content unchanged', () => {
    const content = 'just regular text'
    expect(toggleTaskLine(content, 0, FIXED_DATE)).toBe(content)
  })

  test('non-task line in range returns content unchanged', () => {
    const content = '- [ ] task\nsome prose'
    expect(toggleTaskLine(content, 1, FIXED_DATE)).toBe(content)
  })

  test('preserves indentation when toggling', () => {
    const content = '  - [ ] indented task'
    const result = toggleTaskLine(content, 0, FIXED_DATE)
    expect(result).toBe('  - [x] indented task ✅ 2026-05-18')
  })

  test('toggling one line does not affect surrounding lines', () => {
    const content = 'before\n- [ ] task\nafter'
    const result = toggleTaskLine(content, 1, FIXED_DATE)
    const lines = result.split('\n')
    expect(lines[0]).toBe('before')
    expect(lines[1]).toBe('- [x] task ✅ 2026-05-18')
    expect(lines[2]).toBe('after')
  })

  test('multi-line: toggling line 0 leaves other lines intact', () => {
    const content = '- [ ] first\n- [x] second ✅ 2026-01-01\n- [ ] third'
    const result = toggleTaskLine(content, 0, FIXED_DATE)
    const lines = result.split('\n')
    expect(lines[0]).toBe('- [x] first ✅ 2026-05-18')
    expect(lines[1]).toBe('- [x] second ✅ 2026-01-01')
    expect(lines[2]).toBe('- [ ] third')
  })

  test('multi-line: toggling line 2 leaves other lines intact', () => {
    const content = '- [x] first\n- [ ] second\n- [ ] third'
    const result = toggleTaskLine(content, 2, FIXED_DATE)
    const lines = result.split('\n')
    expect(lines[0]).toBe('- [x] first')
    expect(lines[1]).toBe('- [ ] second')
    expect(lines[2]).toBe('- [x] third ✅ 2026-05-18')
  })

  test('CRLF input: splitting is correct, output is joined with \\n', () => {
    // The implementation splits on /\r?\n/ but joins with '\n' (no CRLF).
    // This is a consequence of the array.join('\n') call at the end.
    const content = 'header\r\n- [ ] foo\r\nfooter'
    const result = toggleTaskLine(content, 1, FIXED_DATE)
    // Output is LF-joined, not CRLF
    expect(result).toBe('header\n- [x] foo ✅ 2026-05-18\nfooter')
  })

  test('check-then-uncheck round-trips to the original content', () => {
    const original = '- [ ] round-trip me'
    const checked = toggleTaskLine(original, 0, FIXED_DATE)
    // Checked version has a date stamp; unchecking should strip it
    const unchecked = toggleTaskLine(checked, 0, FIXED_DATE)
    expect(unchecked).toBe(original)
  })
})

// ── toggleTaskLineText ────────────────────────────────────────────────────────

describe('toggleTaskLineText', () => {
  test('returns null for non-task lines', () => {
    expect(toggleTaskLineText('just text', FIXED_DATE)).toBeNull()
    expect(toggleTaskLineText('- a list item', FIXED_DATE)).toBeNull()
    expect(toggleTaskLineText('', FIXED_DATE)).toBeNull()
  })

  test('checks a `- [ ]` task and appends ✅ date', () => {
    expect(toggleTaskLineText('- [ ] foo', FIXED_DATE)).toBe('- [x] foo ✅ 2026-05-18')
  })

  test('unchecks a `- [x] ... ✅ date` task and strips the date', () => {
    expect(toggleTaskLineText('- [x] foo ✅ 2026-01-15', FIXED_DATE)).toBe('- [ ] foo')
  })

  test('accepts `*` bullets (broader than toggleTaskLine)', () => {
    expect(toggleTaskLineText('* [ ] star', FIXED_DATE)).toBe('* [x] star ✅ 2026-05-18')
    expect(toggleTaskLineText('* [x] star ✅ 2026-05-18', FIXED_DATE)).toBe('* [ ] star')
  })

  test('accepts `+` bullets', () => {
    expect(toggleTaskLineText('+ [ ] plus', FIXED_DATE)).toBe('+ [x] plus ✅ 2026-05-18')
    expect(toggleTaskLineText('+ [x] plus ✅ 2026-05-18', FIXED_DATE)).toBe('+ [ ] plus')
  })

  test('accepts numbered list bullets', () => {
    expect(toggleTaskLineText('1. [ ] numbered', FIXED_DATE)).toBe('1. [x] numbered ✅ 2026-05-18')
    expect(toggleTaskLineText('12. [x] numbered ✅ 2026-05-18', FIXED_DATE)).toBe('12. [ ] numbered')
  })

  test('preserves indentation', () => {
    expect(toggleTaskLineText('    - [ ] indented', FIXED_DATE)).toBe('    - [x] indented ✅ 2026-05-18')
  })

  test('uppercase [X] is treated as checked', () => {
    expect(toggleTaskLineText('- [X] upper', FIXED_DATE)).toBe('- [ ] upper')
  })

  test('checking a task whose body already has a ✅ date keeps the existing date', () => {
    expect(toggleTaskLineText('- [ ] foo ✅ 2026-01-15', FIXED_DATE)).toBe('- [x] foo ✅ 2026-01-15')
  })

  test('check-then-uncheck round-trips to the original line', () => {
    const original = '- [ ] round trip'
    const checked = toggleTaskLineText(original, FIXED_DATE)!
    expect(toggleTaskLineText(checked, FIXED_DATE)).toBe(original)
  })
})

// ── removeTaskPrefixFromLine ──────────────────────────────────────────────────

describe('removeTaskPrefixFromLine', () => {
  test('returns null for non-task lines', () => {
    expect(removeTaskPrefixFromLine('just text')).toBeNull()
    expect(removeTaskPrefixFromLine('- a list item without checkbox')).toBeNull()
    expect(removeTaskPrefixFromLine('')).toBeNull()
  })

  test('strips `- [ ] ` from an open task', () => {
    expect(removeTaskPrefixFromLine('- [ ] buy milk')).toBe('buy milk')
  })

  test('strips `- [x] ` from a checked task and KEEPS the ✅ date', () => {
    expect(removeTaskPrefixFromLine('- [x] buy milk ✅ 2026-05-18')).toBe('buy milk ✅ 2026-05-18')
  })

  test('preserves leading indentation', () => {
    expect(removeTaskPrefixFromLine('    - [ ] indented')).toBe('    indented')
    expect(removeTaskPrefixFromLine('\t- [x] tabbed')).toBe('\ttabbed')
  })

  test('works for `*`, `+`, and numbered list bullets', () => {
    expect(removeTaskPrefixFromLine('* [ ] star')).toBe('star')
    expect(removeTaskPrefixFromLine('+ [x] plus')).toBe('plus')
    expect(removeTaskPrefixFromLine('1. [ ] numbered')).toBe('numbered')
    expect(removeTaskPrefixFromLine('12. [X] long-numbered')).toBe('long-numbered')
  })

  test('strips the marker for an empty-body task line', () => {
    // Note: the regex requires `\]\s+` so the trailing space is consumed.
    expect(removeTaskPrefixFromLine('- [ ] ')).toBe('')
  })
})

// ── parseTaskMetadata ─────────────────────────────────────────────────────────

describe('parseTaskMetadata', () => {
  test('plain body returns nulls + normal priority', () => {
    expect(parseTaskMetadata('write report')).toEqual({
      text: 'write report',
      completedDate: null,
      dueDate: null,
      scheduledDate: null,
      startDate: null,
      priority: 'normal',
      recurrence: null,
    })
  })

  test('extracts due, scheduled, start, and done dates + strips them from text', () => {
    const out = parseTaskMetadata('write report 📅 2026-05-20 ⏳ 2026-05-19 🛫 2026-05-18 ✅ 2026-05-21')
    expect(out.text).toBe('write report')
    expect(out.dueDate).toBe('2026-05-20')
    expect(out.scheduledDate).toBe('2026-05-19')
    expect(out.startDate).toBe('2026-05-18')
    expect(out.completedDate).toBe('2026-05-21')
  })

  test('priority emojis map to the correct level', () => {
    expect(parseTaskMetadata('a ⏫').priority).toBe('highest')
    expect(parseTaskMetadata('a 🔼').priority).toBe('high')
    expect(parseTaskMetadata('a 🔽').priority).toBe('low')
    expect(parseTaskMetadata('a ⏬').priority).toBe('lowest')
  })

  test('marker can appear before the body text', () => {
    const out = parseTaskMetadata('📅 2026-05-20 fix the bug')
    expect(out.text).toBe('fix the bug')
    expect(out.dueDate).toBe('2026-05-20')
  })

  test('multiple markers of the same kind take the first occurrence', () => {
    const out = parseTaskMetadata('a 📅 2026-05-20 b 📅 2026-12-31')
    expect(out.dueDate).toBe('2026-05-20')
    expect(out.text).toBe('a b')
  })
})

describe('extractTasks — metadata round-trip', () => {
  test('parses every metadata marker on a single line', () => {
    const notes: TaskSourceNote[] = [
      { id: 'n1', content: '- [ ] thing ⏫ 📅 2026-05-20 ⏳ 2026-05-19 🛫 2026-05-18' },
    ]
    const tasks = extractTasks(notes)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      text: 'thing',
      priority: 'highest',
      dueDate: '2026-05-20',
      scheduledDate: '2026-05-19',
      startDate: '2026-05-18',
      completedDate: null,
      completed: false,
    })
  })
})

describe('toggleTaskLineText — preserves metadata', () => {
  test('checking a task with priority + due keeps both markers and appends ✅ date', () => {
    const before = '- [ ] thing ⏫ 📅 2026-05-20'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    expect(after).toContain('⏫')
    expect(after).toContain('📅 2026-05-20')
    expect(after).toContain('✅ 2026-05-19')
    expect(after?.startsWith('- [x] ')).toBe(true)
  })

  test('unchecking strips ✅ date but keeps priority + due', () => {
    const before = '- [x] thing ⏫ 📅 2026-05-20 ✅ 2026-05-19'
    const after = toggleTaskLineText(before)
    expect(after).toContain('⏫')
    expect(after).toContain('📅 2026-05-20')
    expect(after).not.toContain('✅')
    expect(after?.startsWith('- [ ] ')).toBe(true)
  })
})

// ── Recurrence (🔁) ───────────────────────────────────────────────────────────

describe('parseTaskMetadata — recurrence', () => {
  test('captures a "every week" rule', () => {
    const out = parseTaskMetadata('water plants 🔁 every week')
    expect(out.recurrence).toBe('every week')
    expect(out.text).toBe('water plants')
  })

  test('captures a "every month on the 1st" rule', () => {
    const out = parseTaskMetadata('pay rent 🔁 every month on the 1st')
    expect(out.recurrence).toBe('every month on the 1st')
    expect(out.text).toBe('pay rent')
  })

  test('captures recurrence even when followed by other markers', () => {
    const out = parseTaskMetadata('a 🔁 every 2 weeks 📅 2026-05-20')
    expect(out.recurrence).toBe('every 2 weeks')
    expect(out.dueDate).toBe('2026-05-20')
    expect(out.text).toBe('a')
  })

  test('returns null recurrence when no 🔁 present', () => {
    expect(parseTaskMetadata('plain task').recurrence).toBeNull()
  })
})

describe('toggleTaskLineText — recurring task creates next instance', () => {
  test('checking a recurring task with due date inserts the next instance above', () => {
    const before = '- [ ] water plants 🔁 every week 📅 2026-05-20'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    expect(after).not.toBeNull()
    const lines = after!.split('\n')
    expect(lines).toHaveLength(2)
    // New open instance above, with due date rolled forward by 1 week.
    // Canonical order: priority → 📅 → ⏳ → 🛫 → 🔁 → ✅.
    expect(lines[0]).toBe('- [ ] water plants 📅 2026-05-27 🔁 every week')
    // Completed line below with the ✅ stamp
    expect(lines[1]).toContain('- [x] ')
    expect(lines[1]).toContain('📅 2026-05-20')
    expect(lines[1]).toContain('🔁 every week')
    expect(lines[1]).toContain('✅ 2026-05-19')
  })

  test('preserves priority on the new instance', () => {
    const before = '- [ ] thing 🔁 every day ⏫ 📅 2026-05-20'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    const lines = after!.split('\n')
    expect(lines[0]).toContain('⏫')
    expect(lines[0]).toContain('📅 2026-05-21')
  })

  test('"every month on the 1st" jumps to the 1st of the next month', () => {
    const before = '- [ ] pay rent 🔁 every month on the 1st 📅 2026-05-15'
    const after = toggleTaskLineText(before, new Date(2026, 4, 15))
    const lines = after!.split('\n')
    expect(lines[0]).toContain('📅 2026-06-01')
  })

  test('shifts scheduled / start dates by the same delta as the due date', () => {
    const before = '- [ ] thing 🔁 every week 📅 2026-05-20 ⏳ 2026-05-18 🛫 2026-05-17'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    const lines = after!.split('\n')
    expect(lines[0]).toContain('📅 2026-05-27')
    expect(lines[0]).toContain('⏳ 2026-05-25')
    expect(lines[0]).toContain('🛫 2026-05-24')
  })

  test('"when done" anchors on today instead of the due date', () => {
    const before = '- [ ] thing 🔁 every day when done 📅 2026-05-10'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    const lines = after!.split('\n')
    // Anchor = today (2026-05-19), next-anchor = 2026-05-20 (every day).
    // Delta = +1 day, so due rolls from 2026-05-10 → 2026-05-11. This is
    // the Obsidian-Tasks "when done" behavior: ignore the calendar gap
    // between today and the due date — just step forward one period.
    expect(lines[0]).toContain('📅 2026-05-11')
  })

  test('unchecking a recurring task does NOT create a new instance', () => {
    const before = '- [x] thing 🔁 every week 📅 2026-05-20 ✅ 2026-05-19'
    const after = toggleTaskLineText(before)
    expect(after).not.toBeNull()
    expect(after!.includes('\n')).toBe(false)
    expect(after).toContain('- [ ]')
  })

  test('unparseable rule falls back to single-line toggle', () => {
    const before = '- [ ] thing 🔁 sometimes maybe'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    expect(after!.includes('\n')).toBe(false)
    expect(after).toContain('- [x]')
    expect(after).toContain('✅ 2026-05-19')
    // Recurrence marker is preserved on the completed line
    expect(after).toContain('🔁 sometimes maybe')
  })

  test('recurring task with no dates uses today as anchor', () => {
    const before = '- [ ] thing 🔁 every day'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    const lines = after!.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('- [ ] thing 🔁 every day')
    expect(lines[1]).toContain('✅ 2026-05-19')
  })

  test('preserves bullet style for the new instance', () => {
    const before = '  * [ ] nested 🔁 every day'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    const lines = after!.split('\n')
    expect(lines[0].startsWith('  * [ ] ')).toBe(true)
    expect(lines[1].startsWith('  * [x] ')).toBe(true)
  })
})

// ── toggleTaskLine (whole-note path used by TaskQueryBlock) ──────────────────

describe('toggleTaskLine — recurring task splicing', () => {
  const NOW = new Date(2026, 4, 19) // 2026-05-19

  test('recurring task at line 0 of a single-line note produces 2-line content', () => {
    const content = '- [ ] water plants 🔁 every week 📅 2026-05-20'
    const result = toggleTaskLine(content, 0, NOW)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('- [ ]')
    expect(lines[0]).toContain('📅 2026-05-27')
    expect(lines[1]).toContain('- [x]')
    expect(lines[1]).toContain('✅ 2026-05-19')
  })

  test('recurring task in a multi-line note: surrounding lines are preserved', () => {
    const content = [
      'Some heading',
      '- [ ] water plants 🔁 every week 📅 2026-05-20',
      'Trailing text',
    ].join('\n')

    const result = toggleTaskLine(content, 1, NOW)
    const lines = result.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('Some heading')
    expect(lines[1]).toContain('- [ ]')
    expect(lines[1]).toContain('📅 2026-05-27')
    expect(lines[2]).toContain('- [x]')
    expect(lines[2]).toContain('✅ 2026-05-19')
    expect(lines[3]).toBe('Trailing text')
  })

  test('recurring task at last line: no trailing blank line added', () => {
    const content = [
      'First line',
      '- [ ] water plants 🔁 every week 📅 2026-05-20',
    ].join('\n')

    const result = toggleTaskLine(content, 1, NOW)
    const lines = result.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('First line')
    expect(lines[1]).toContain('- [ ]')
    expect(lines[2]).toContain('- [x]')
  })

  test('non-recurring task at same position still produces a single completed line', () => {
    const content = '- [ ] water plants 📅 2026-05-20'
    const result = toggleTaskLine(content, 0, NOW)
    const lines = result.split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('- [x]')
    expect(lines[0]).toContain('✅ 2026-05-19')
  })

  test('out-of-range lineNumber returns content unchanged', () => {
    const content = '- [ ] water plants 🔁 every week 📅 2026-05-20'
    expect(toggleTaskLine(content, -1, NOW)).toBe(content)
    expect(toggleTaskLine(content, 5, NOW)).toBe(content)
  })

  test('CRLF content is normalised to LF in the toggled result', () => {
    const content = '- [ ] water plants 🔁 every week 📅 2026-05-20\r\nNext line'
    const result = toggleTaskLine(content, 0, NOW)
    expect(result).not.toContain('\r')
    const lines = result.split('\n')
    // 3 lines: new open instance, completed, Next line
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('Next line')
  })
})
