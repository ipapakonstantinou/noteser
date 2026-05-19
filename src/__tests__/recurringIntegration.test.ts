/**
 * recurringIntegration.test.ts
 *
 * End-to-end-shaped test for recurring tasks. User reports that clicking a
 * recurring task's checkbox AND pressing Alt+Shift+L AND saving via the
 * task-edit modal all fail to produce the expected 2-line output (new
 * instance above + ✅-stamped completed below) in both Firefox and Chrome,
 * despite the unit tests in tasks.test.ts passing.
 *
 * This file simulates the exact call paths the editor uses so we catch
 * any glue-layer regression that doesn't show up in pure-function tests.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { toggleTaskLineText, toggleTaskLine, serializeTaskLine, parseTaskMetadata } from '../utils/tasks'
import { nextRecurrence } from '../utils/recurrence'

// ── parseTaskMetadata with the U+FE0F variant selector ──────────────────────
//
// macOS / iOS / many Linux emoji pickers attach U+FE0F (variation selector
// 16) to the 🔁 codepoint, producing the string "🔁️" instead of bare
// "🔁". Without explicit handling, our negative-lookahead capture pulled
// the U+FE0F INTO the rule string, then parseRule rejected it. This is the
// root cause of the user's "recurring doesn't work in Firefox or Chrome"
// report — the unit tests all used bare 🔁 so the bug never surfaced.

describe('parseTaskMetadata — handles the U+FE0F (VS16) emoji presentation', () => {
  test('🔁\\uFE0F is treated the same as bare 🔁', () => {
    const out = parseTaskMetadata('water plants 🔁️ every week 📅 2026-05-20')
    expect(out.recurrence).toBe('every week')
    expect(out.dueDate).toBe('2026-05-20')
  })

  test('toggleTaskLineText creates a new instance for 🔁\\uFE0F rules', () => {
    const before = '- [ ] thing 🔁️ every week 📅 2026-05-20'
    const after = toggleTaskLineText(before, new Date(2026, 4, 19))
    expect(after).not.toBeNull()
    expect(after!.includes('\n')).toBe(true)
  })
})

// ── parseTaskMetadata in the literal emoji form ───────────────────────────────

describe('parseTaskMetadata — literal 🔁 marker', () => {
  test('captures recurrence when 🔁 is the only metadata', () => {
    const out = parseTaskMetadata('water plants 🔁 every week')
    expect(out.recurrence).toBe('every week')
    expect(out.text).toBe('water plants')
  })

  test('captures recurrence when followed by 📅 due', () => {
    const out = parseTaskMetadata('water plants 🔁 every week 📅 2026-05-20')
    expect(out.recurrence).toBe('every week')
    expect(out.dueDate).toBe('2026-05-20')
  })

  test('captures recurrence when PRECEDED by 📅 due', () => {
    // Canonical order is priority → due → scheduled → start → recurrence → done.
    // But users may type in any order. The parser must handle that.
    const out = parseTaskMetadata('water plants 📅 2026-05-20 🔁 every week')
    expect(out.recurrence).toBe('every week')
    expect(out.dueDate).toBe('2026-05-20')
  })

  test('handles "every 2 weeks" multiplier', () => {
    expect(parseTaskMetadata('a 🔁 every 2 weeks').recurrence).toBe('every 2 weeks')
  })

  test('handles "every month on the 1st"', () => {
    expect(parseTaskMetadata('a 🔁 every month on the 1st').recurrence).toBe('every month on the 1st')
  })
})

// ── toggleTaskLineText through the full editor path ──────────────────────────

describe('toggleTaskLineText — full integration', () => {
  const NOW = new Date(2026, 4, 19)

  test('recurring task with due → emits 2 lines (open above, completed below)', () => {
    const before = '- [ ] water plants 🔁 every week 📅 2026-05-20'
    const after = toggleTaskLineText(before, NOW)
    expect(after).not.toBeNull()
    expect(after!.includes('\n')).toBe(true)
    const lines = after!.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('- [ ]')
    expect(lines[0]).toContain('📅 2026-05-27')
    expect(lines[0]).toContain('🔁 every week')
    expect(lines[1]).toContain('- [x]')
    expect(lines[1]).toContain('✅ 2026-05-19')
  })

  test('recurring task with NO dates uses today as anchor', () => {
    const before = '- [ ] water plants 🔁 every week'
    const after = toggleTaskLineText(before, NOW)
    const lines = after!.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('- [ ] water plants 🔁 every week')
    expect(lines[1]).toContain('- [x] water plants 🔁 every week ✅ 2026-05-19')
  })

  test('preserves bullet style on the new instance', () => {
    const before = '* [ ] thing 🔁 every day'
    const after = toggleTaskLineText(before, NOW)
    const lines = after!.split('\n')
    expect(lines[0].startsWith('* [ ] ')).toBe(true)
    expect(lines[1].startsWith('* [x] ')).toBe(true)
  })
})

// ── toggleTaskLine (whole-content variant used by TaskQueryBlock) ─────────────

describe('toggleTaskLine — splices a recurring 2-line replacement back into the doc', () => {
  test('inserts the new instance line ABOVE the completed line in the source', () => {
    const noteContent = [
      '# my note',
      '',
      '- [ ] water plants 🔁 every week 📅 2026-05-20',
      '- [ ] unrelated task',
    ].join('\n')

    const next = toggleTaskLine(noteContent, 2, new Date(2026, 4, 19))
    const lines = next.split('\n')

    // Header + blank line are unchanged.
    expect(lines[0]).toBe('# my note')
    expect(lines[1]).toBe('')
    // The new open instance landed at index 2 (where the old line was).
    expect(lines[2]).toContain('- [ ]')
    expect(lines[2]).toContain('📅 2026-05-27')
    // The completed instance is right after it.
    expect(lines[3]).toContain('- [x]')
    expect(lines[3]).toContain('✅ 2026-05-19')
    // The unrelated task slid down to index 4.
    expect(lines[4]).toBe('- [ ] unrelated task')
  })
})

// ── CodeMirror dispatch path (the editor click + Alt+Shift+L) ────────────────

describe('CodeMirror dispatch — multi-line replacement actually lands in the doc', () => {
  test('view.dispatch with a 2-line insert produces a 2-line doc', () => {
    const state = EditorState.create({
      doc: '- [ ] water plants 🔁 every week 📅 2026-05-20',
    })
    // Use a detached view (no DOM parent) — we only care about the
    // document model, which is fully driven by transactions.
    const view = new EditorView({ state })
    const line = view.state.doc.line(1)
    const newLine = toggleTaskLineText(line.text, new Date(2026, 4, 19))
    expect(newLine).not.toBeNull()
    expect(newLine!.includes('\n')).toBe(true)

    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newLine! },
    })

    const after = view.state.doc.toString()
    const split = after.split('\n')
    expect(split).toHaveLength(2)
    expect(split[0]).toContain('- [ ]')
    expect(split[0]).toContain('📅 2026-05-27')
    expect(split[1]).toContain('- [x]')
    expect(split[1]).toContain('✅ 2026-05-19')

    view.destroy()
  })
})

// ── Sanity check the recurrence helper at the literal-string boundary ────────

describe('nextRecurrence with literal emoji-laden rule strings', () => {
  test('rule string extracted from a body parses cleanly', () => {
    const parsed = parseTaskMetadata('a 🔁 every week 📅 2026-05-20')
    expect(parsed.recurrence).not.toBeNull()
    expect(nextRecurrence(parsed.recurrence!, '2026-05-20')).toBe('2026-05-27')
  })
})

// ── Modal-save round-trip: serializeTaskLine output is itself parseable ──────

describe('serializeTaskLine output is round-trip parseable', () => {
  test('a serialized recurring task with all fields parses back to the same parts', () => {
    const serialized = serializeTaskLine({
      open: true,
      text: 'thing',
      priority: 'high',
      dueDate: '2026-05-27',
      scheduledDate: null,
      startDate: null,
      completedDate: null,
      recurrence: 'every week',
    })
    expect(serialized).toBe('- [ ] thing 🔼 📅 2026-05-27 🔁 every week')

    // The line should match UI_TASK_LINE_REGEX (the gate used by every
    // consumer to decide "is this a task line").
    const m = serialized.match(/^(\s*(?:[-*+]|\d+\.)\s+\[)( |x|X)(\]\s+)(.*)$/)
    expect(m).not.toBeNull()
    const body = m![4]
    const reparsed = parseTaskMetadata(body)
    expect(reparsed.priority).toBe('high')
    expect(reparsed.dueDate).toBe('2026-05-27')
    expect(reparsed.recurrence).toBe('every week')
  })
})
