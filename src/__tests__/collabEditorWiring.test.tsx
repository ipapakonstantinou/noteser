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
let docText = '' // what the editor shows
const fakeView = {
  dispatch: jest.fn(),
  state: { doc: { toString: () => docText, get length() { return docText.length } } },
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
// Each binding's extension names its room, so a test can see which one got
// plugged into the editor; `roomText` is what a room holds at its first sync.
type BindOpts = { url: string; room: string; initialContent: string; onEnded?: () => void }
const destroySpy = jest.fn()
let roomText = ''
const syncHandlers: Record<string, Array<(s: boolean) => void>> = {}
const createCollabBindingMock = jest.fn((opts: BindOpts) => ({
  extension: { room: opts.room },
  doc: {},
  provider: {
    on: (event: string, cb: (s: boolean) => void) => {
      if (event === 'sync') (syncHandlers[opts.room] ??= []).push(cb)
    },
    off: () => {},
  },
  ytext: { toString: () => roomText },
  destroy: destroySpy,
}))
jest.mock('../components/editor/collabExtension', () => ({
  createCollabBinding: (opts: BindOpts) => createCollabBindingMock(opts),
}))
type Tr = { changes?: unknown; effects?: { value?: { extension?: { room?: string } | unknown[] } } }
const dispatched = () => fakeView.dispatch.mock.calls.map(c => c[0] as Tr)
const plugged = (room: string) =>
  dispatched().some(tr => (tr.effects?.value?.extension as { room?: string } | undefined)?.room === room)
const unplugged = () => dispatched().some(tr => Array.isArray(tr.effects?.value?.extension) && (tr.effects!.value!.extension as unknown[]).length === 0)
const cleared = () => dispatched().some(tr => tr.changes !== undefined)
const fireFirstSync = (room: string) => act(() => { for (const cb of syncHandlers[room] ?? []) cb(true) })

import { CodeMirrorEditor } from '../components/editor/CodeMirrorEditor'
import { useNoteStore } from '../stores/noteStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useActiveCollabStore } from '../stores/activeCollabStore'
import { useToastStore } from '../stores/toastStore'

const ORIGINAL_URL = process.env.NEXT_PUBLIC_YJS_WS_URL

const flushMicrotasks = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  idb.clear()
  createCollabBindingMock.mockClear()
  destroySpy.mockClear()
  fakeView.dispatch.mockClear()
  docText = ''
  roomText = ''
  for (const k of Object.keys(syncHandlers)) delete syncHandlers[k]
  useToastStore.setState({ toasts: [] })
  useActiveCollabStore.setState({ activeNoteIds: new Set(), endedRooms: [] })
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  // Collab gates on collaborationMode (default 'off' → never connect). These
  // wiring tests want the ENABLED path, so connect for every note via 'repo'.
  // The DORMANT test deletes the transport URL, which keeps it off regardless.
  useSettingsStore.setState({ collaborationMode: 'repo' })
})

afterEach(() => {
  if (ORIGINAL_URL == null) delete process.env.NEXT_PUBLIC_YJS_WS_URL
  else process.env.NEXT_PUBLIC_YJS_WS_URL = ORIGINAL_URL
  useSettingsStore.setState({ collaborationMode: 'off' })
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

  // H2: a device that adopts a new id (sync after another device's Stop live)
  // must leave the old room, or old links keep reaching its typing.
  test('a new collabId on the note moves the binding to the new room', async () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com'
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'x' })
    renderEditor(note.id, 'x')
    await flushMicrotasks()
    const oldRoom = createCollabBindingMock.mock.calls[0][0].room
    const newRoom = '8d3f5c2a-1b4e-4c6d-9e7f-0a1b2c3d4e5f'
    act(() => {
      useNoteStore.setState(s => ({ notes: s.notes.map(n => (n.id === note.id ? { ...n, collabId: newRoom } : n)) }))
    })
    await flushMicrotasks()
    expect(destroySpy).toHaveBeenCalledTimes(1)
    expect(createCollabBindingMock.mock.calls.map(c => c[0].room)).toEqual([oldRoom, newRoom])
  })

  test("the server's 4410 turns live off for the note and drops the binding", async () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com'
    useSettingsStore.setState({ collaborationMode: 'per-note' })
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'x' })
    useActiveCollabStore.getState().activate(note.id)
    renderEditor(note.id, 'x')
    await flushMicrotasks()
    const { onEnded } = createCollabBindingMock.mock.calls[0][0] as { onEnded?: () => void }
    act(() => { onEnded!() })
    expect(useActiveCollabStore.getState().isActive(note.id)).toBe(false)
    expect(destroySpy).toHaveBeenCalledTimes(1)
    expect(createCollabBindingMock).toHaveBeenCalledTimes(1) // no rejoin
  })

  test('repo mode: a 4410 detaches the binding itself and says so', async () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com'
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'x' })
    renderEditor(note.id, 'x')
    await flushMicrotasks()
    fakeView.dispatch.mockClear()
    const { onEnded } = createCollabBindingMock.mock.calls[0][0]
    act(() => { onEnded!() })
    expect(destroySpy).toHaveBeenCalledTimes(1)
    expect(unplugged()).toBe(true)
    expect(useToastStore.getState().toasts.map(t => t.message).join()).toMatch(/was ended.*off live until the note gets a new link/)
  })

  // Repo mode keeps the note open and enabled after an end or a declined room,
  // so the NEXT id from sync must still take the compare path, not a fresh join
  // that clears the editor and lets the room replace the solo edits.
  const typedSolo = (noteId: string, text: string) => {
    docText = text
    act(() => {
      useNoteStore.setState(s => ({ notes: s.notes.map(n => (n.id === noteId ? { ...n, content: text } : n)) }))
    })
  }
  const moveTo = async (noteId: string, room: string) => {
    fakeView.dispatch.mockClear()
    act(() => {
      useNoteStore.setState(s => ({ notes: s.notes.map(n => (n.id === noteId ? { ...n, collabId: room } : n)) }))
    })
    await flushMicrotasks()
  }

  test('repo mode: after a 4410, a new id from sync never replaces the solo edits', async () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com'
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'base' })
    renderEditor(note.id, 'base')
    await flushMicrotasks()
    act(() => { createCollabBindingMock.mock.calls[0][0].onEnded!() }) // someone pressed Stop
    typedSolo(note.id, 'base + my solo edit')
    roomText = 'the stopper text'
    const moved = '8d3f5c2a-1b4e-4c6d-9e7f-0a1b2c3d4e5f'
    await moveTo(note.id, moved)
    expect(createCollabBindingMock.mock.calls[1][0]).toMatchObject({ room: moved, initialContent: '' })
    expect(cleared()).toBe(false)
    expect(plugged(moved)).toBe(false)
    fireFirstSync(moved)
    expect(plugged(moved)).toBe(false)
    expect(cleared()).toBe(false)
  })

  test('repo mode: after a declined room, the next id from sync still compares first', async () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com'
    const note = useNoteStore.getState().addNote({ title: 'A', content: 'mine' })
    renderEditor(note.id, 'mine')
    await flushMicrotasks()
    docText = 'mine'
    roomText = 'not mine'
    const first = '8d3f5c2a-1b4e-4c6d-9e7f-0a1b2c3d4e5f'
    await moveTo(note.id, first)
    fireFirstSync(first) // declined: live off, binding detached, note still open
    typedSolo(note.id, 'mine + more')
    const second = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
    await moveTo(note.id, second)
    expect(createCollabBindingMock.mock.calls[2][0]).toMatchObject({ room: second, initialContent: '' })
    expect(cleared()).toBe(false)
    expect(plugged(second)).toBe(false)
  })

  // Sync moves an open, live note to another room (another device pressed Stop).
  async function liveNoteThenMoved(local: string, room: string) {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com'
    useSettingsStore.setState({ collaborationMode: 'per-note' })
    const note = useNoteStore.getState().addNote({ title: 'A', content: local })
    useActiveCollabStore.getState().activate(note.id)
    renderEditor(note.id, local)
    await flushMicrotasks()
    docText = local // what yCollab left on screen while live
    fakeView.dispatch.mockClear()
    roomText = room
    const moved = '8d3f5c2a-1b4e-4c6d-9e7f-0a1b2c3d4e5f'
    act(() => {
      useNoteStore.setState(s => ({ notes: s.notes.map(n => (n.id === note.id ? { ...n, collabId: moved } : n)) }))
    })
    await flushMicrotasks()
    return { noteId: note.id, moved }
  }

  test('a moved note whose new room holds other text: live off, text kept, never plugged in', async () => {
    const { noteId, moved } = await liveNoteThenMoved('my edits since the stop', 'the other device copy')
    expect(createCollabBindingMock.mock.calls[1][0]).toMatchObject({ room: moved, initialContent: '' })
    expect(plugged(moved)).toBe(false) // held back until the first sync
    fireFirstSync(moved)
    expect(plugged(moved)).toBe(false)
    expect(cleared()).toBe(false) // the editor text was never replaced
    expect(destroySpy).toHaveBeenCalledTimes(2) // old binding, then the held-back one
    expect(useActiveCollabStore.getState().isActive(noteId)).toBe(false)
    expect(useToastStore.getState().toasts.map(t => t.message).join()).toMatch(/moved it to a new link/)
  })

  test('a moved note whose new room is empty is not pre-filled with this copy', async () => {
    const { moved } = await liveNoteThenMoved('my copy', '')
    fireFirstSync(moved)
    expect(createCollabBindingMock.mock.calls[1][0].initialContent).toBe('') // nothing to seed
    expect(plugged(moved)).toBe(false)
  })

  test('a moved note whose new room holds exactly this text joins it', async () => {
    const { noteId, moved } = await liveNoteThenMoved('same text', 'same text')
    fireFirstSync(moved)
    expect(plugged(moved)).toBe(true)
    expect(cleared()).toBe(false)
    expect(useActiveCollabStore.getState().isActive(noteId)).toBe(true)
  })
})
