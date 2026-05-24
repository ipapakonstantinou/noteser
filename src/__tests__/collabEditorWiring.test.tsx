/**
 * @jest-environment jsdom
 *
 * Integration test for the CodeMirrorEditor ↔ collaboration wiring.
 *
 * We mock the heavy CodeMirror component (so jsdom doesn't have to mount a
 * real CM6 view) and mock createCollabBinding (so no Y.Doc / websocket is
 * built). The mocked CodeMirror immediately hands a fake EditorView to
 * `onCreateEditor`, which is what the collab effect needs to attach.
 *
 * Two assertions matter most:
 *  - DORMANT: with NEXT_PUBLIC_YJS_WS_URL unset, createCollabBinding is
 *    NEVER called — the editor is exactly as it was before Phase B.
 *  - ENABLED: with the env var set, the binding is created with the note's
 *    stable collabId as the room, and torn down on unmount.
 */

import { render, act } from '@testing-library/react'

const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((key: string) => Promise.resolve(idb.get(key))),
  set: jest.fn((key: string, value: unknown) => { idb.set(key, value); return Promise.resolve() }),
  del: jest.fn((key: string) => { idb.delete(key); return Promise.resolve() }),
  keys: jest.fn(() => Promise.resolve([...idb.keys()])),
}))

// A fake EditorView with the surface the collab effect touches.
const fakeView = {
  dispatch: jest.fn(),
  state: { doc: { toString: () => '' } },
}

// Mock @uiw/react-codemirror with a stub that fires onCreateEditor with the
// fake view, so cmRef.current.view is populated for the collab effect.
jest.mock('@uiw/react-codemirror', () => {
  const React = require('react')
  const Stub = React.forwardRef((props: { onCreateEditor?: (v: unknown) => void }, ref: unknown) => {
    const { onCreateEditor } = props
    React.useImperativeHandle(ref, () => ({ view: fakeView }))
    React.useEffect(() => { onCreateEditor?.(fakeView) }, [onCreateEditor])
    return React.createElement('div', { 'data-testid': 'cm-stub' })
  })
  Stub.displayName = 'CodeMirrorStub'
  return { __esModule: true, default: Stub }
})

// Mock the binding factory so no real Y.Doc / websocket is constructed.
const destroySpy = jest.fn()
const createCollabBindingMock = jest.fn((_opts: { url: string; room: string; initialContent: string }) => ({
  extension: [],
  doc: {},
  provider: {},
  ytext: {},
  destroy: destroySpy,
}))
jest.mock('../components/editor/collabExtension', () => ({
  createCollabBinding: (opts: { url: string; room: string; initialContent: string }) => createCollabBindingMock(opts),
}))

import { CodeMirrorEditor } from '../components/editor/CodeMirrorEditor'
import { useNoteStore } from '../stores/noteStore'

const ORIGINAL_URL = process.env.NEXT_PUBLIC_YJS_WS_URL

const flushMicrotasks = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  idb.clear()
  createCollabBindingMock.mockClear()
  destroySpy.mockClear()
  fakeView.dispatch.mockClear()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
})

afterEach(() => {
  if (ORIGINAL_URL == null) delete process.env.NEXT_PUBLIC_YJS_WS_URL
  else process.env.NEXT_PUBLIC_YJS_WS_URL = ORIGINAL_URL
})

function renderEditor(noteId: string, content: string) {
  return render(
    <CodeMirrorEditor
      noteId={noteId}
      initialContent={content}
      activeNotes={[]}
      onSave={() => {}}
      onWikilinkNavigate={() => {}}
    />,
  )
}

describe('CodeMirrorEditor collaboration wiring', () => {
  test('DORMANT: env unset → createCollabBinding is never called, no collabId minted', async () => {
    delete process.env.NEXT_PUBLIC_YJS_WS_URL
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'hello' })
    renderEditor(note.id, 'hello')
    await flushMicrotasks()
    expect(createCollabBindingMock).not.toHaveBeenCalled()
    // The note must NOT have grown a collabId on the dormant path.
    expect(useNoteStore.getState().notes.find(n => n.id === note.id)?.collabId).toBeUndefined()
  })

  test('ENABLED: env set → binding created with the note collabId as room', async () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com'
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'hello world' })
    renderEditor(note.id, 'hello world')
    await flushMicrotasks()

    expect(createCollabBindingMock).toHaveBeenCalledTimes(1)
    const arg = createCollabBindingMock.mock.calls[0][0]
    const collabId = useNoteStore.getState().notes.find(n => n.id === note.id)?.collabId
    expect(collabId).toBeTruthy()
    expect(arg.url).toBe('wss://collab.example.com')
    expect(arg.room).toBe(collabId)
    expect(arg.initialContent).toBe('hello world')
    // The compartment was reconfigured (binding extension spliced in).
    expect(fakeView.dispatch).toHaveBeenCalled()
  })

  test('ENABLED: binding is destroyed on unmount (no socket leak)', async () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com'
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'x' })
    const { unmount } = renderEditor(note.id, 'x')
    await flushMicrotasks()
    expect(createCollabBindingMock).toHaveBeenCalledTimes(1)
    act(() => { unmount() })
    expect(destroySpy).toHaveBeenCalled()
  })
})
