jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { cycleListTypeCommand } from '../components/editor/CodeMirrorEditor'

function setup(doc: string, anchor: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor },
  })
  const view = new EditorView({ state })
  return view
}

describe('cycleListTypeCommand cursor placement', () => {
  test('cycling an empty line to a task lands the caret AFTER the new "- [ ] " marker', () => {
    const view = setup('', 0)
    const handled = cycleListTypeCommand(view)
    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe('1. ')
    expect(view.state.selection.main.head).toBe(3)
  })

  test('cycling again advances state and keeps caret AFTER the new marker', () => {
    const view = setup('1. ', 3)
    cycleListTypeCommand(view)
    expect(view.state.doc.toString()).toBe('- [ ] ')
    expect(view.state.selection.main.head).toBe(6)
  })

  test('cycling a populated line places the caret at the end of the rewritten line', () => {
    const view = setup('hello', 5)
    cycleListTypeCommand(view)
    expect(view.state.doc.toString()).toBe('1. hello')
    expect(view.state.selection.main.head).toBe(8)
  })
})
