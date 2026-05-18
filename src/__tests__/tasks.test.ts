/**
 * tasks.test.ts
 *
 * Unit tests for src/utils/tasks.ts — pure functions, no mocks needed.
 */

import { extractTasks, todayISO, toggleTaskLine, toggleTaskLineText, Task, TaskSourceNote } from '../utils/tasks'

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
