jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { toggleCheckboxStatus } from '../components/editor/CodeMirrorEditor'

function setup(doc: string, anchor: number) {
  const state = EditorState.create({ doc, selection: { anchor } })
  return new EditorView({ state })
}

describe('Mod+L (toggleCheckboxStatus) caret placement', () => {
  test('empty line converts to a task and parks the caret AFTER "- [ ] "', () => {
    const view = setup('', 0)
    const handled = toggleCheckboxStatus(view)
    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe('- [ ] ')
    expect(view.state.selection.main.head).toBe(6)
  })

  test('plain line "hello" converts to "- [ ] hello" with caret at end', () => {
    const view = setup('hello', 5)
    toggleCheckboxStatus(view)
    expect(view.state.doc.toString()).toBe('- [ ] hello')
    expect(view.state.selection.main.head).toBe(11)
  })

  test('existing task line flips done/undone without being forced to end', () => {
    const doc = '- [ ] task'
    const view = setup(doc, 8)
    toggleCheckboxStatus(view)
    // The task got marked done (possibly with a date stamp appended via
    // toggleTaskLineText). We do NOT teleport the caret to the new end of
    // line — that's the trap the convert-from-plain path corrects, and we
    // want the flip case to keep its old behaviour (CodeMirror's default
    // selection mapping after a whole-line replace).
    expect(view.state.doc.toString()).toMatch(/^- \[x\] task/)
  })
})
