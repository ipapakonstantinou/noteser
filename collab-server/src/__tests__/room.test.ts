// YRoom on the WebSocket Hibernation API, driven through a fake
// DurableObjectState. A "wake" = a fresh YRoom on the same state, which is
// what the runtime does after evicting a hibernated object.
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

import { YRoom, type Env } from '../index'

class FakeSocket {
  sent: Uint8Array[] = []
  closedWith: number | null = null
  private att: unknown = null
  send(data: Uint8Array) {
    this.sent.push(data)
  }
  close(code: number) {
    this.closedWith = code
  }
  serializeAttachment(a: unknown) {
    this.att = structuredClone(a)
  }
  deserializeAttachment() {
    return structuredClone(this.att)
  }
}

function fakeState() {
  const sockets: FakeSocket[] = []
  const storage = new Map<string, unknown>()
  let ready: Promise<void> = Promise.resolve()
  const state = {
    sockets,
    storage: {
      get: async (k: string) => storage.get(k),
      put: async (k: string, v: unknown) => void storage.set(k, v),
      setAlarm: vi.fn(async () => {}),
    },
    acceptWebSocket: (ws: FakeSocket) => void sockets.push(ws),
    getWebSockets: () => sockets.filter(s => s.closedWith === null),
    blockConcurrencyWhile: (fn: () => Promise<void>) => {
      ready = fn()
      return ready
    },
    ready: () => ready,
  }
  return state
}

type State = ReturnType<typeof fakeState>

async function wake(state: State, env = {}) {
  const room = new YRoom(state as unknown as DurableObjectState, env as Env)
  await state.ready()
  return room
}

function connect(room: YRoom) {
  const ws = new FakeSocket()
  ;(room as unknown as { accept(ws: unknown): void }).accept(ws)
  return ws
}

const send = (room: YRoom, ws: FakeSocket, msg: Uint8Array) =>
  room.webSocketMessage(ws as unknown as WebSocket, msg.slice().buffer)

function updateMessage(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, text)
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, 0)
  syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(doc))
  return encoding.toUint8Array(enc)
}

function awarenessMessage(clientId: number, state: unknown): Uint8Array {
  const aw = new awarenessProtocol.Awareness(new Y.Doc())
  clearInterval(aw._checkInterval)
  aw.clientID = clientId
  aw.setLocalState({}) // clock 0 is never applied by peers, like a real client
  aw.setLocalState(state as Record<string, unknown>)
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, 1)
  encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(aw, [clientId]))
  return encoding.toUint8Array(enc)
}

// Awareness frames in `sent`, decoded to {clientId: state}.
function awarenessFrames(ws: FakeSocket): Record<number, unknown>[] {
  return ws.sent.flatMap(frame => {
    const d = decoding.createDecoder(frame)
    if (decoding.readVarUint(d) !== 1) return []
    const u = decoding.createDecoder(decoding.readVarUint8Array(d))
    const out: Record<number, unknown> = {}
    for (let n = decoding.readVarUint(u); n > 0; n--) {
      const id = decoding.readVarUint(u)
      decoding.readVarUint(u) // clock
      out[id] = JSON.parse(decoding.readVarString(u))
    }
    return [out]
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('YRoom hibernation', () => {
  it('leaves no timers running (they would pin the object awake)', async () => {
    vi.useFakeTimers()
    const state = fakeState()
    const room = await wake(state)
    const a = connect(room)
    send(room, a, updateMessage('hi'))
    send(room, a, awarenessMessage(7, { user: 'a' }))
    expect(vi.getTimerCount()).toBe(0)
    expect(state.storage.setAlarm).toHaveBeenCalledTimes(1)
  })

  it('broadcasts updates to peers only and restores the doc after a wake', async () => {
    const state = fakeState()
    const room = await wake(state)
    const a = connect(room)
    const b = connect(room)
    const [aBefore, bBefore] = [a.sent.length, b.sent.length]
    send(room, a, updateMessage('hello'))
    expect(a.sent.length).toBe(aBefore) // sender is skipped
    expect(b.sent.length).toBe(bBefore + 1)

    await room.alarm()
    const woken = await wake(state)
    const doc = (woken as unknown as { doc: Y.Doc }).doc
    expect(doc.getText('t').toString()).toBe('hello')
  })

  it('keeps presence across a wake and clears it when the peer leaves', async () => {
    const state = fakeState()
    const room = await wake(state)
    const a = connect(room)
    const b = connect(room)
    send(room, a, awarenessMessage(7, { user: 'a' }))

    const woken = await wake(state)
    const c = connect(woken)
    expect(awarenessFrames(c)).toEqual([{ 7: { user: 'a' } }])

    b.sent = []
    a.closedWith = 1000
    woken.webSocketClose(a as unknown as WebSocket, 1000)
    expect(awarenessFrames(b)).toEqual([{ 7: null }])
  })

  it('persists when the last socket closes', async () => {
    const state = fakeState()
    const room = await wake(state)
    const a = connect(room)
    send(room, a, updateMessage('bye'))
    room.webSocketClose(a as unknown as WebSocket, 1000)
    await Promise.resolve()
    const woken = await wake(state)
    expect((woken as unknown as { doc: Y.Doc }).doc.getText('t').toString()).toBe('bye')
  })
})

describe('YRoom limits', () => {
  it('closes on an oversized frame', async () => {
    const state = fakeState()
    const room = await wake(state, { MAX_MESSAGE_BYTES: '10' })
    const a = connect(room)
    send(room, a, new Uint8Array(11))
    expect(a.closedWith).toBe(1009)
  })

  it('closes a socket that floods messages', async () => {
    const state = fakeState()
    const room = await wake(state, { MAX_MESSAGES_PER_WINDOW: '2' })
    const a = connect(room)
    for (let i = 0; i < 3; i++) send(room, a, new Uint8Array([9]))
    expect(a.closedWith).toBe(1008)
  })

  it('rejects a joiner when the room is full', async () => {
    const state = fakeState()
    const room = await wake(state, { MAX_CONNECTIONS_PER_ROOM: '1' })
    connect(room)
    const res = await room.fetch(new Request('https://x/r', { headers: { Upgrade: 'websocket' } }))
    expect(res.status).toBe(429)
  })
})
