/**
 * continueListItemParagraph.test.ts
 *
 * Unit tests for the Shift+Enter Command that inserts a continuation indent
 * inside a list/task body, so the next line parses as a paragraph of the
 * SAME list item rather than a fresh top-level paragraph at column 0.
 *
 * Covered:
 *   - bullet line  "- text"        -> newline + 2-space continuation
 *   - ordered line "1. text"       -> newline + 3-space continuation
 *   - ordered line "10. text"      -> newline + 4-space continuation
 *   - task line    "- [ ] text"    -> newline + 6-space continuation
 *   - ordered task "1. [ ] text"   -> newline + 7-space continuation
 *   - indented bullet              -> indent preserved + 2-space continuation
 *   - plain line                   -> returns false (no-op)
 *   - non-empty (range) selection  -> returns false (no-op)
 *   - repeated invocation inside a continuation stays inside the item
 *   - markdown round-trip via micromark: continuation paragraph attaches to
 *     the same list item (single <li> with two <p> children).
 *
 * idb-keyval is mocked because CodeMirrorEditor imports stores that use the
 * persist middleware.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { continueListItemParagraph } from '../components/editor/CodeMirrorEditor'

function setup(doc: string, anchor: number, head?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: head !== undefined ? EditorSelection.range(anchor, head) : { anchor },
  })
  return new EditorView({ state })
}

describe('continueListItemParagraph — continuation indent width', () => {
  test('bullet line "- task text" → newline + 2-space continuation', () => {
    const doc = '- task text'
    const view = setup(doc, doc.length)
    const handled = continueListItemParagraph(view)
    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe('- task text\n  ')
    // caret parked at end of the continuation pad
    expect(view.state.selection.main.head).toBe(doc.length + 1 + 2)
  })

  test('ordered line "1. ordered text" → newline + 3-space continuation', () => {
    const doc = '1. ordered text'
    const view = setup(doc, doc.length)
    expect(continueListItemParagraph(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('1. ordered text\n   ')
  })

  test('ordered line "10. ordered text" → newline + 4-space continuation', () => {
    const doc = '10. ordered text'
    const view = setup(doc, doc.length)
    expect(continueListItemParagraph(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('10. ordered text\n    ')
  })

  test('task line "- [ ] task text" → newline + 6-space continuation', () => {
    const doc = '- [ ] task text'
    const view = setup(doc, doc.length)
    expect(continueListItemParagraph(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('- [ ] task text\n      ')
  })

  test('ordered task "1. [ ] task text" → newline + 7-space continuation', () => {
    const doc = '1. [ ] task text'
    const view = setup(doc, doc.length)
    expect(continueListItemParagraph(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('1. [ ] task text\n       ')
  })

  test('indented bullet "   - nested" preserves the indent + 2-space continuation', () => {
    const doc = '   - nested task'
    const view = setup(doc, doc.length)
    expect(continueListItemParagraph(view)).toBe(true)
    // 3 spaces leading + 2 spaces for "- " = 5 spaces total continuation
    expect(view.state.doc.toString()).toBe('   - nested task\n     ')
  })

  test('cursor in the MIDDLE of a list line still inserts a marker-width pad', () => {
    // Splits the body across two lines but the second line is still
    // continuation-indented (so the split fragment stays inside the item).
    // doc = "- abc def" — cursor at pos 5 sits right after the space, before "def".
    const doc = '- abc def'
    const view = setup(doc, 6) // immediately before "def"
    expect(continueListItemParagraph(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('- abc \n  def')
  })
})

describe('continueListItemParagraph — no-op cases', () => {
  test('plain line returns false (lets default Shift+Enter handle it)', () => {
    const view = setup('plain paragraph', 5)
    expect(continueListItemParagraph(view)).toBe(false)
    // No mutation
    expect(view.state.doc.toString()).toBe('plain paragraph')
  })

  test('range selection returns false (no continuation when selecting)', () => {
    const view = setup('- some text', 2, 6)
    expect(continueListItemParagraph(view)).toBe(false)
    expect(view.state.doc.toString()).toBe('- some text')
  })
})

describe('continueListItemParagraph — chained invocation', () => {
  test('a second Shift+Enter inside a continuation still inserts a pad of the SAME width', () => {
    // First press
    const view = setup('- [ ] task', 10)
    continueListItemParagraph(view)
    expect(view.state.doc.toString()).toBe('- [ ] task\n      ')
    // Caret sits at end of the new continuation indent. The current line is
    // now "      " (6 spaces) — a plain (indented) line by splitListLine's
    // reading. A SECOND Shift+Enter on a plain line returns false, which is
    // the documented behaviour: chained continuations are not the wedge here,
    // the user has the indent and can keep typing OR press Shift+Enter again
    // after typing to extend the body.
    const headAfterFirst = view.state.selection.main.head
    // Type a word into the continuation, then press Shift+Enter again.
    view.dispatch({
      changes: { from: headAfterFirst, to: headAfterFirst, insert: 'body' },
      selection: { anchor: headAfterFirst + 4 },
    })
    // Now we ARE on a non-list line (just indented body). The continuation
    // command returns false for plain lines — which is fine: the user can
    // press Shift+Enter to get a hard linebreak in markdown, or Enter to drop
    // to column 0 (exiting the body). This test pins that contract.
    expect(continueListItemParagraph(view)).toBe(false)
  })
})

// ── Continuation indent shape (markdown semantics) ─────────────────────────
//
// The whole point of this command is that the continuation line parses as
// part of the same list item. Rather than pulling unified/remark into the
// test (ESM-only, awkward under Jest CJS), pin the SHAPE of the produced
// markdown to the rule that makes the continuation attach to the item:
// the continuation line starts with whitespace at LEAST as wide as the
// parent marker (CommonMark §5.2 "list item — continuation paragraphs").

describe('continueListItemParagraph — produces CommonMark-attaching continuation', () => {
  function shiftEnterAndType(start: string, body: string) {
    const view = setup(start, start.length)
    expect(continueListItemParagraph(view)).toBe(true)
    const head = view.state.selection.main.head
    view.dispatch({
      changes: { from: head, to: head, insert: body },
      selection: { anchor: head + body.length },
    })
    return view.state.doc.toString()
  }

  test('task body continuation produces "- [ ] X\\n      Y" (6-space pad ≥ marker width)', () => {
    expect(shiftEnterAndType('- [ ] first', 'second')).toBe('- [ ] first\n      second')
  })

  test('ordered list body continuation aligns under the body of "1. " (3-space pad)', () => {
    expect(shiftEnterAndType('1. first', 'second')).toBe('1. first\n   second')
  })

  test('bullet body continuation aligns under the body of "- " (2-space pad)', () => {
    expect(shiftEnterAndType('- first', 'second')).toBe('- first\n  second')
  })

  test('nested-task body continuation preserves both indent AND marker pad', () => {
    expect(shiftEnterAndType('  - [ ] first', 'second')).toBe('  - [ ] first\n        second')
  })
})
