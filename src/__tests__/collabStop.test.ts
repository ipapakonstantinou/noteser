/**
 * @jest-environment jsdom
 *
 * H2 (2026-11-15 review): "Stop live" ends the session for everyone and the
 * note gets a fresh room id; a device the server closes with 4410 turns live
 * off and never joins that id again.
 */

const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((key: string) => Promise.resolve(idb.get(key))),
  set: jest.fn((key: string, value: unknown) => { idb.set(key, value); return Promise.resolve() }),
  del: jest.fn((key: string) => { idb.delete(key); return Promise.resolve() }),
  keys: jest.fn(() => Promise.resolve([...idb.keys()])),
}))

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { useNoteStore } from '../stores/noteStore'
import { useActiveCollabStore } from '../stores/activeCollabStore'
import { useToastStore } from '../stores/toastStore'
import { useSettingsStore } from '../stores/settingsStore'
import { stopLiveCollab, onLiveSessionEnded } from '../hooks/useCollaboration'
import { createCollabBinding, type ProviderLike } from '../components/editor/collabExtension'
import { serializeNote } from '../utils/githubSync/internal'
import { isValidCollabId } from '../utils/collabId'
import { SYNC_REQUEST_EVENT } from '../utils/events'

// Stands in for the browser WebSocket, for stopLiveCollab and for y-websocket.
class FakeSocket {
  static all: FakeSocket[] = []
  binaryType = 'blob'
  readyState = 0
  sent: unknown[] = []
  closed = false
  onopen: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onmessage: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: unknown) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
}

const URL_ = 'wss://collab.example/tok'
const ORIGINAL_WS = global.WebSocket
const ORIGINAL_URL = process.env.NEXT_PUBLIC_YJS_WS_URL

beforeEach(() => {
  idb.clear()
  FakeSocket.all = []
  ;(global as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
  process.env.NEXT_PUBLIC_YJS_WS_URL = URL_
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useActiveCollabStore.setState({ activeNoteIds: new Set(), endedRooms: [] })
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  ;(global as unknown as { WebSocket: unknown }).WebSocket = ORIGINAL_WS
  if (ORIGINAL_URL == null) delete process.env.NEXT_PUBLIC_YJS_WS_URL
  else process.env.NEXT_PUBLIC_YJS_WS_URL = ORIGINAL_URL
  jest.useRealTimers()
})

function liveNote() {
  const note = useNoteStore.getState().addNote({ title: 'Shared', content: 'hello' })
  const room = useNoteStore.getState().ensureCollabId(note.id)!
  useActiveCollabStore.getState().activate(note.id)
  return { id: note.id, room }
}
const collabIdOf = (id: string) => useNoteStore.getState().notes.find(n => n.id === id)!.collabId
const endedToasts = () => useToastStore.getState().toasts.filter(t => /was ended/.test(t.message))
const toastsMatching = (re: RegExp) => useToastStore.getState().toasts.filter(t => re.test(t.message))
const ENDED_FOR_ALL = /ended for everyone/
const NOT_CLOSED = /could not be closed/

describe('stopLiveCollab', () => {
  test('sends the end frame to the room, replaces the id, turns live off', () => {
    const { id, room } = liveNote()
    const syncRequests = jest.fn()
    window.addEventListener(SYNC_REQUEST_EVENT, syncRequests)

    stopLiveCollab(id)

    expect(useActiveCollabStore.getState().isActive(id)).toBe(false)
    const fresh = collabIdOf(id)
    expect(isValidCollabId(fresh)).toBe(true)
    expect(fresh).not.toBe(room)
    // The serializer publishes the new id, so sync carries it to other devices.
    const file = serializeNote(useNoteStore.getState().notes.find(n => n.id === id)!)
    expect(file).toContain(`collabId: ${fresh}`)
    expect(file).not.toContain(room)

    expect(FakeSocket.all.map(s => s.url)).toEqual([`${URL_}/${room}`])
    expect(syncRequests).toHaveBeenCalledTimes(1)
    window.removeEventListener(SYNC_REQUEST_EVENT, syncRequests)
    // "Ended for everyone" only once the frame went out on an open socket.
    expect(toastsMatching(ENDED_FOR_ALL)).toHaveLength(0)
    const ws = FakeSocket.all[0]
    ws.onopen!()
    expect(ws.sent).toEqual([new Uint8Array([100])])
    expect(ws.closed).toBe(true)
    ws.onclose?.({ code: 1000, reason: '' })
    expect(toastsMatching(ENDED_FOR_ALL)).toHaveLength(1)
    expect(toastsMatching(NOT_CLOSED)).toHaveLength(0)
  })

  test('a refused or offline end frame says so; the new id still holds', () => {
    const { id, room } = liveNote()
    stopLiveCollab(id)
    FakeSocket.all[0].onclose!({ code: 1006, reason: '' }) // full room (429), offline
    expect(toastsMatching(NOT_CLOSED)).toHaveLength(1)
    expect(toastsMatching(ENDED_FOR_ALL)).toHaveLength(0)
    expect(collabIdOf(id)).not.toBe(room)
  })

  test('an end frame with no answer gives up after 10 s and says so', () => {
    jest.useFakeTimers()
    const { id } = liveNote()
    stopLiveCollab(id)
    jest.advanceTimersByTime(9_999)
    expect(toastsMatching(NOT_CLOSED)).toHaveLength(0)
    jest.advanceTimersByTime(1)
    expect(toastsMatching(NOT_CLOSED)).toHaveLength(1)
    expect(FakeSocket.all[0].closed).toBe(true)
  })

  test('the next join (Go live, Share) uses the new id, never the old one', () => {
    const { id, room } = liveNote()
    stopLiveCollab(id)
    const next = useNoteStore.getState().ensureCollabId(id)
    expect(next).toBe(collabIdOf(id))
    expect(next).not.toBe(room)
  })

  test('a note that never had a room only turns live off', () => {
    const note = useNoteStore.getState().addNote({ title: 'Solo', content: '' })
    useActiveCollabStore.getState().activate(note.id)
    stopLiveCollab(note.id)
    expect(useActiveCollabStore.getState().isActive(note.id)).toBe(false)
    expect(collabIdOf(note.id)).toBeUndefined()
    expect(FakeSocket.all).toHaveLength(0)
  })

  test('the stopper does not get "session was ended" from its own 4410', () => {
    const { id, room } = liveNote()
    stopLiveCollab(id)
    onLiveSessionEnded(id, room)
    expect(endedToasts()).toHaveLength(0)
  })
})

describe('onLiveSessionEnded (another holder stopped it)', () => {
  test('repo mode says the note stays off live until it gets a new link', () => {
    const { id, room } = liveNote()
    useSettingsStore.setState({ collaborationMode: 'repo' })
    onLiveSessionEnded(id, room)
    expect(toastsMatching(/off live until the note gets a new link/)).toHaveLength(1)
    useSettingsStore.setState({ collaborationMode: 'off' })
  })

  test('live off, one line for the user, and the id is never joined again', () => {
    const { id, room } = liveNote()
    onLiveSessionEnded(id, room)
    onLiveSessionEnded(id, room) // close + error, or two panes on the note
    expect(useActiveCollabStore.getState().isActive(id)).toBe(false)
    expect(endedToasts()).toHaveLength(1)
    // The id stays until sync brings the stopper's new one (clean 3-way merge)...
    expect(collabIdOf(id)).toBe(room)
    // ...but this device's next join mints a new room instead of the old one.
    const next = useNoteStore.getState().ensureCollabId(id)
    expect(isValidCollabId(next)).toBe(true)
    expect(next).not.toBe(room)
  })
})

describe('binding + real y-websocket', () => {
  function bind(onEnded: () => void) {
    const factory = (url: string, room: string, doc: Y.Doc) =>
      new WebsocketProvider(url, room, doc, {
        WebSocketPolyfill: FakeSocket as unknown as typeof WebSocket,
        disableBc: true,
      }) as unknown as ProviderLike
    return createCollabBinding({ url: URL_, room: 'r1', initialContent: '', user: null, providerFactory: factory, onEnded })
  }

  test('a 4410 close reports the end once and stops reconnecting', () => {
    jest.useFakeTimers()
    const onEnded = jest.fn()
    const binding = bind(onEnded)
    const ws = FakeSocket.all[0]
    ws.onopen!()
    ws.onclose!({ code: 4410, reason: 'Session ended' })
    jest.advanceTimersByTime(60_000)
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(FakeSocket.all).toHaveLength(1)
    binding.destroy()
  })

  test('any other close is transient: it reconnects and does not end anything', () => {
    jest.useFakeTimers()
    const onEnded = jest.fn()
    const binding = bind(onEnded)
    FakeSocket.all[0].onopen!()
    FakeSocket.all[0].onclose!({ code: 1006, reason: '' })
    jest.advanceTimersByTime(5_000)
    expect(onEnded).not.toHaveBeenCalled()
    expect(FakeSocket.all.length).toBeGreaterThan(1)
    binding.destroy()
  })

  test('a device that slept through the stop: its reconnect gets 4410, ends once, stops', () => {
    jest.useFakeTimers()
    const onEnded = jest.fn()
    const binding = bind(onEnded)
    FakeSocket.all[0].onopen!()
    FakeSocket.all[0].onclose!({ code: 1006, reason: '' }) // asleep: the socket just died
    jest.advanceTimersByTime(5_000)
    expect(FakeSocket.all).toHaveLength(2) // the wake-up reconnect
    FakeSocket.all[1].onopen!() // the worker accepts...
    FakeSocket.all[1].onclose!({ code: 4410, reason: 'Session ended' }) // ...and closes: ended
    jest.advanceTimersByTime(60_000)
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(FakeSocket.all).toHaveLength(2)
    binding.destroy()
  })

  test('another final close (e.g. 4403) is not read as "session ended"', () => {
    const onEnded = jest.fn()
    const binding = bind(onEnded)
    FakeSocket.all[0].onopen!()
    FakeSocket.all[0].onclose!({ code: 4403, reason: '' })
    expect(onEnded).not.toHaveBeenCalled()
    binding.destroy()
  })
})
