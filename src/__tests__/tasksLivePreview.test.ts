/**
 * tasksLivePreview.test.ts
 *
 * Verifies that tasksLivePreviewField (a CodeMirror StateField) produces the
 * correct DecorationSet for ```tasks fenced code blocks.
 *
 * Strategy:
 *   - Build real EditorState objects with the @codemirror/lang-markdown parser
 *     plus the field under test.  No browser DOM is needed — StateField logic
 *     runs entirely in memory.
 *   - Mock './TaskQueryBlock' so the module import of tasksLivePreview.tsx
 *     doesn't pull in React stores (Zustand + idb-keyval).
 *   - Mock 'idb-keyval' as a belt-and-suspenders guard (folderTreeToolbar
 *     pattern) in case any transitive import reaches it.
 *   - TaskQueryWidget is exported from the source file so we can inspect its
 *     `source` field directly without calling toDOM().
 */

// ── System-boundary mocks (must appear before any import) ─────────────────────

// Mock TaskQueryBlock so the Zustand stores + IndexedDB never initialise.
jest.mock('../components/editor/TaskQueryBlock', () => ({
  TaskQueryBlock: () => null,
  default: () => null,
}))

// Belt-and-suspenders: prevent idb-keyval from failing in jsdom.
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  tasksLivePreviewField,
  tasksLivePreview,
  TaskQueryWidget,
} from '../components/editor/tasksLivePreview'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(doc: string, cursorPos = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ base: markdownLanguage }),
      tasksLivePreview,
    ],
  })
}

interface DecoInfo {
  from: number
  to: number
  widget: unknown
}

/** Collect all decorations from the field as plain objects. */
function collectDecos(state: EditorState): DecoInfo[] {
  const decos = state.field(tasksLivePreviewField)
  const result: DecoInfo[] = []
  const cursor = decos.iter()
  while (cursor.value !== null) {
    result.push({
      from: cursor.from,
      to: cursor.to,
      widget: cursor.value.spec?.widget ?? null,
    })
    cursor.next()
  }
  return result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('tasksLivePreviewField StateField', () => {

  // 1. Empty document
  test('empty document produces no decorations', () => {
    const state = makeState('')
    expect(collectDecos(state)).toHaveLength(0)
  })

  // 2. Fence with cursor outside (before the fence)
  test('tasks fence with cursor outside produces exactly one block-replace decoration', () => {
    // Doc structure:
    //   line 1: "before"         pos  0 –  6
    //   line 2: ""               pos  7 –  7
    //   line 3: "```tasks"       pos  8 – 16
    //   line 4: "not done"       pos 17 – 25
    //   line 5: "```"            pos 26 – 29
    //   line 6: ""               pos 30 – 30
    // FencedCode: from 8, to 29  (startLine 3, endLine 5)
    // Cursor at pos 0 → line 1 → outside the fence → decoration IS produced.
    const doc = 'before\n\n```tasks\nnot done\n```\n'
    const state = makeState(doc, 0)
    const decos = collectDecos(state)

    expect(decos).toHaveLength(1)
    expect(decos[0].from).toBe(8)
    expect(decos[0].to).toBe(29)
  })

  // 3. Captured source on the widget equals the fence body
  test('widget source equals the fence body text (no trailing newline)', () => {
    const doc = 'before\n\n```tasks\nnot done\n```\n'
    const state = makeState(doc, 0)
    const decos = collectDecos(state)

    expect(decos).toHaveLength(1)
    const widget = decos[0].widget as TaskQueryWidget
    expect(widget).toBeInstanceOf(TaskQueryWidget)
    // lezer-markdown CodeText node for this doc spans pos 17–25 = "not done"
    expect(widget.source).toBe('not done')
  })

  // 4. Cursor inside the fence body → no decoration
  test('cursor on the body line of the fence produces no decoration', () => {
    // Simple fence-only doc.
    // line 1: "```tasks"  pos 0–8
    // line 2: "not done"  pos 9–17
    // line 3: "```"       pos 18–21
    // Cursor at pos 13 → line 2 → inside fence → no decoration.
    const doc = '```tasks\nnot done\n```\n'
    const state = makeState(doc, 13)
    expect(collectDecos(state)).toHaveLength(0)
  })

  // 5. Cursor on the opening ``` line → no decoration
  test('cursor on the opening backtick line produces no decoration', () => {
    const doc = '```tasks\nnot done\n```\n'
    // pos 0–8 is line 1, the opening fence line; cursor at pos 3.
    const state = makeState(doc, 3)
    expect(collectDecos(state)).toHaveLength(0)
  })

  // 6. Cursor on the closing ``` line → no decoration
  test('cursor on the closing backtick line produces no decoration', () => {
    const doc = '```tasks\nnot done\n```\n'
    // line 3 (closing): from 18 to 21; cursor at pos 19.
    const state = makeState(doc, 19)
    expect(collectDecos(state)).toHaveLength(0)
  })

  // 7. Non-tasks fence (```js) → no decoration
  test('non-tasks fence (```js) produces no decoration', () => {
    const doc = '```js\nconsole.log(1)\n```\n'
    const state = makeState(doc, 0)
    expect(collectDecos(state)).toHaveLength(0)
  })

  // 8. Fence with no language info → no decoration
  test('fence with no language info produces no decoration', () => {
    // lezer-markdown emits no CodeInfo child when the fence has no language tag.
    const doc = '```\nnot done\n```\n'
    const state = makeState(doc, 0)
    expect(collectDecos(state)).toHaveLength(0)
  })

  // 9. Two tasks fences, cursor outside both → two decorations in source order
  test('two tasks fences with cursor outside both produce two decorations', () => {
    // line 1: "```tasks"   pos  0–8   (FencedCode 0–16)
    // line 2: "foo"        pos  9–11
    // line 3: "```"        pos 12–14 (→ FencedCode to:16, endLine:3)
    // line 4: ""           pos 17–17
    // line 5: "```tasks"   pos 18–26  (FencedCode 18–34)
    // line 6: "bar"        pos 27–29
    // line 7: "```"        pos 30–32 (→ FencedCode to:34, endLine:7)
    // line 8: ""           pos 35–35
    // Cursor at pos 35 → line 8 → outside both fences.
    const doc = '```tasks\nfoo\n```\n\n```tasks\nbar\n```\n'
    const state = makeState(doc, doc.length)
    const decos = collectDecos(state)

    expect(decos).toHaveLength(2)
    expect(decos[0].from).toBeLessThan(decos[1].from)

    const w0 = decos[0].widget as TaskQueryWidget
    const w1 = decos[1].widget as TaskQueryWidget
    expect(w0.source).toBe('foo')
    expect(w1.source).toBe('bar')
  })

  // 10. One tasks fence and one python fence → only one decoration (tasks only)
  test('one tasks fence and one python fence produce one decoration for the tasks fence', () => {
    const doc = '```tasks\nfoo\n```\n\n```python\nprint(1)\n```\n'
    // Cursor at pos 0 → line 1 = opening of tasks fence → inside → suppressed
    // Need cursor after both fences
    const state = makeState(doc, doc.length)
    const decos = collectDecos(state)

    expect(decos).toHaveLength(1)
    const w = decos[0].widget as TaskQueryWidget
    expect(w.source).toBe('foo')
  })

  // 11. Case-insensitivity: ```TASKS → decoration produced (pinning actual behavior)
  test('```TASKS (uppercase) produces one decoration — case-insensitive match', () => {
    // The implementation does: lang.trim().toLowerCase() === 'tasks'
    // So TASKS → 'tasks' → match.
    const doc = 'before\n\n```TASKS\nnot done\n```\n'
    const state = makeState(doc, 0)
    const decos = collectDecos(state)

    expect(decos).toHaveLength(1)
    const w = decos[0].widget as TaskQueryWidget
    expect(w.source).toBe('not done')
  })
})
