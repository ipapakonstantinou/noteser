/**
 * foldableHeadings.test.ts
 *
 * Unit + integration coverage for collapsible heading sections.
 *
 * Unit — `headingFoldRange` (the pure range computation off the lezer tree):
 *   - a `##` folds until the next `##` or `#`
 *   - a nested `###` folds independently (stops at the next `###`/`##`/`#`)
 *   - the last heading folds to EOF
 *   - a heading with no body folds nothing (null)
 *   - a non-heading line folds nothing (null)
 *
 * Integration — mount an EditorView with the folding extension:
 *   - folding a heading hides the body lines (foldedRanges covers them) and
 *     leaves the document text byte-for-byte unchanged
 *   - unfolding restores (no folded ranges, text still unchanged)
 *   - folding coexists with the markdown live-preview decorations (no crash,
 *     content intact)
 *
 * idb-keyval is mocked because pulling in CodeMirrorEditor (for the live
 * preview integration check) transitively imports persist-backed stores.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldCode, unfoldCode, foldedRanges } from '@codemirror/language'
import { headingFoldRange, foldableHeadings } from '../components/editor/foldableHeadings'
import { markdownLivePreview } from '../components/editor/markdownLivePreview'

const md = markdown({ base: markdownLanguage })

function makeState(doc: string, extensions: unknown[] = [md]) {
  return EditorState.create({ doc, extensions: extensions as never })
}

/** Resolve the fold range for the heading on the 1-indexed `lineNo`. */
function foldRangeForLine(state: EditorState, lineNo: number) {
  const line = state.doc.line(lineNo)
  return headingFoldRange(state, line.from, line.to)
}

describe('headingFoldRange — section range off the lezer tree', () => {
  test('a `##` folds until the next `##`', () => {
    const doc = ['# Title', '## A', 'body a1', 'body a2', '## B', 'body b'].join('\n')
    const state = makeState(doc)
    const range = foldRangeForLine(state, 2) // "## A"
    expect(range).not.toBeNull()
    // from = end of "## A" line
    expect(range!.from).toBe(state.doc.line(2).to)
    // to = just before the "## B" line
    expect(range!.to).toBe(state.doc.line(5).from - 1)
    // The folded text is exactly the two body lines.
    expect(state.doc.sliceString(range!.from, range!.to)).toBe('\nbody a1\nbody a2')
  })

  test('a `##` also stops at a higher-level `#`', () => {
    const doc = ['# One', '## Sub', 'body', '# Two', 'more'].join('\n')
    const state = makeState(doc)
    const range = foldRangeForLine(state, 2) // "## Sub"
    expect(range).not.toBeNull()
    // Stops before "# Two" (level 1 <= 2).
    expect(range!.to).toBe(state.doc.line(4).from - 1)
  })

  test('a nested `###` folds independently of the enclosing `##`', () => {
    const doc = [
      '## Parent', // 1
      'p body', //    2
      '### Child', //  3
      'c body 1', //   4
      'c body 2', //   5
      '## Next', //    6
    ].join('\n')
    const state = makeState(doc)
    const child = foldRangeForLine(state, 3) // "### Child"
    expect(child).not.toBeNull()
    // The ### section stops at the next heading of level <= 3, i.e. "## Next".
    expect(child!.to).toBe(state.doc.line(6).from - 1)
    expect(state.doc.sliceString(child!.from, child!.to)).toBe('\nc body 1\nc body 2')

    // The enclosing ## folds the whole thing (its body + the child section).
    const parent = foldRangeForLine(state, 1) // "## Parent"
    expect(parent!.to).toBe(state.doc.line(6).from - 1)
  })

  test('the last heading folds to end-of-document', () => {
    const doc = ['# A', 'a body', '## Last', 'tail 1', 'tail 2'].join('\n')
    const state = makeState(doc)
    const range = foldRangeForLine(state, 3) // "## Last"
    expect(range).not.toBeNull()
    expect(range!.to).toBe(state.doc.length)
    expect(state.doc.sliceString(range!.from, range!.to)).toBe('\ntail 1\ntail 2')
  })

  test('a heading with no body folds nothing', () => {
    const doc = ['## Empty', '## Next', 'body'].join('\n')
    const state = makeState(doc)
    expect(foldRangeForLine(state, 1)).toBeNull() // "## Empty" → "## Next" immediately
  })

  test('a heading at EOF with no body folds nothing', () => {
    const doc = ['# A', 'body', '## End'].join('\n')
    const state = makeState(doc)
    expect(foldRangeForLine(state, 3)).toBeNull()
  })

  test('a non-heading line folds nothing', () => {
    const doc = ['# A', 'just a paragraph'].join('\n')
    const state = makeState(doc)
    expect(foldRangeForLine(state, 2)).toBeNull()
  })
})

describe('heading folding — EditorView integration (view-only, no corruption)', () => {
  function mount(doc: string, extensions: unknown[]) {
    const state = makeState(doc, extensions)
    const view = new EditorView({ state })
    return view
  }

  test('folding hides the body and leaves the text unchanged; unfold restores', () => {
    const doc = ['# Title', '## A', 'body a1', 'body a2', '## B', 'body b'].join('\n')
    const view = mount(doc, [md, foldableHeadings])

    // Put the cursor on "## A" and fold via the command (exercises foldService).
    const aLine = view.state.doc.line(2)
    view.dispatch({ selection: { anchor: aLine.from } })
    expect(foldCode(view)).toBe(true)

    // The body lines are now inside a folded range; text is unchanged.
    const folded = foldedRanges(view.state)
    let foldedFrom = -1
    let foldedTo = -1
    folded.between(0, view.state.doc.length, (f, t) => {
      foldedFrom = f
      foldedTo = t
    })
    expect(foldedFrom).toBe(view.state.doc.line(2).to)
    expect(foldedTo).toBe(view.state.doc.line(5).from - 1)
    expect(view.state.doc.toString()).toBe(doc)

    // Unfold restores: no folded ranges, text still pristine.
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } })
    expect(unfoldCode(view)).toBe(true)
    let stillFolded = false
    foldedRanges(view.state).between(0, view.state.doc.length, () => {
      stillFolded = true
    })
    expect(stillFolded).toBe(false)
    expect(view.state.doc.toString()).toBe(doc)

    view.destroy()
  })

  test('folding coexists with the markdown live-preview decorations', () => {
    const doc = [
      '# Heading **bold**',
      '## Section',
      '- a list item',
      '- [ ] a task',
      'a #tag here',
      '## Other',
      'more',
    ].join('\n')
    // Mount with BOTH the live-preview StateField and the folding bundle.
    const view = mount(doc, [md, markdownLivePreview, foldableHeadings])

    const sectionLine = view.state.doc.line(2) // "## Section"
    view.dispatch({ selection: { anchor: sectionLine.from } })
    expect(() => foldCode(view)).not.toThrow()

    // The section body is folded, decorations didn't corrupt anything, and the
    // document text is byte-for-byte identical.
    let folded = false
    foldedRanges(view.state).between(0, view.state.doc.length, () => {
      folded = true
    })
    expect(folded).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)

    view.destroy()
  })
})
