/**
 * @jest-environment jsdom
 *
 * Regression test for the live-collaboration content-DOUBLING bug.
 *
 * We mount a REAL CodeMirror EditorView with the REAL yCollab binding (only
 * the websocket transport is faked — the provider's awareness is a real
 * y-protocols Awareness over the binding's own Y.Doc, and we drive the
 * provider's 'sync' event by hand). This exercises the exact path that
 * doubled content in production:
 *
 *   editor doc + yCollab observer replaying the seeded Y.Text on top of it.
 *
 * The fix builds the editor EMPTY when collab is enabled and lets the Y.Text
 * be the single content source. These tests pin that: after binding + sync the
 * editor holds the note body EXACTLY ONCE — for the seeder (fresh room) and
 * for a joiner (room already populated over the wire).
 */

import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  createCollabBinding,
  type ProviderLike,
  type ProviderFactory,
} from '../components/editor/collabExtension'

// Fake transport: real Awareness (yRemoteSelections needs it), manual 'sync'.
class FakeProvider implements ProviderLike {
  awareness: Awareness
  private handlers: Array<(s: boolean) => void> = []
  constructor(doc: Y.Doc) {
    this.awareness = new Awareness(doc)
  }
  on(_event: 'sync', cb: (s: boolean) => void) { this.handlers.push(cb) }
  off(_event: 'sync', cb: (s: boolean) => void) {
    this.handlers = this.handlers.filter(h => h !== cb)
  }
  destroy() { this.awareness.destroy() }
  fireSync() { this.handlers.forEach(h => h(true)) }
}

let lastProvider: FakeProvider | null = null
const factory: ProviderFactory = (_url, _room, doc) => {
  lastProvider = new FakeProvider(doc)
  return lastProvider
}

// Mount a real editor with the binding spliced in, mirroring how the editor
// renders: `editorDoc` is the value CodeMirror starts with ('' when collab is
// enabled — the fix — or the body, which reproduces the old doubling bug).
function mount(editorDoc: string, body: string) {
  const binding = createCollabBinding({
    url: 'wss://collab.example.com/token',
    room: 'room-1',
    initialContent: body,
    user: null,
    providerFactory: factory,
  })
  const view = new EditorView({
    state: EditorState.create({ doc: editorDoc, extensions: [binding.extension] }),
  })
  return { binding, view }
}

describe('collab binding does not double content', () => {
  test('SEEDER: empty editor + seed-on-sync → body appears exactly once', () => {
    const body = '# Title\nthe body'
    const { binding, view } = mount('', body)
    expect(view.state.doc.toString()).toBe('') // nothing until sync
    lastProvider!.fireSync()
    expect(view.state.doc.toString()).toBe(body) // once, not doubled
    binding.destroy()
    view.destroy()
  })

  test('JOINER: empty editor + content arriving over the wire → body once, no re-seed', () => {
    const body = 'remote body'
    const { binding, view } = mount('', body)
    // Simulate the shared doc being populated by another client before sync.
    binding.ytext.insert(0, body)
    // The yCollab observer should have already replayed it into the editor.
    expect(view.state.doc.toString()).toBe(body)
    // Sync now fires: seed-on-empty must NOT append our local copy.
    lastProvider!.fireSync()
    expect(view.state.doc.toString()).toBe(body)
    binding.destroy()
    view.destroy()
  })

  test('REGRESSION GUARD: initializing the editor WITH the body reproduces the doubling', () => {
    // This is the pre-fix shape (value={initialContent}); it must double, which
    // is exactly why the editor is built EMPTY when collab is enabled.
    const body = 'hello'
    const { binding, view } = mount(body, body)
    lastProvider!.fireSync()
    expect(view.state.doc.toString()).toBe(body + body)
    binding.destroy()
    view.destroy()
  })
})
