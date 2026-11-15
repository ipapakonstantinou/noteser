// YRoom on the WebSocket Hibernation API, driven through a fake
// DurableObjectState. A "wake" = a fresh YRoom on the same state, which is
// what the runtime does after evicting a hibernated object.
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

import worker, { YRoom, type Env } from '../index'

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
  let alarm: number | null = null
  let ready: Promise<void> = Promise.resolve()
  const state = {
    sockets,
    data: storage,
    alarmAt: () => alarm,
    consumeAlarm: () => void (alarm = null),
    storage: {
      get: async (k: string) => storage.get(k),
      put: vi.fn(async (k: string, v: unknown) => void storage.set(k, v)),
      delete: async (k: string) => storage.delete(k),
      deleteAll: async () => storage.clear(),
      setAlarm: vi.fn(async (t: number) => void (alarm = t)),
      deleteAlarm: vi.fn(async () => void (alarm = null)),
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

// M2 (2026-11-15 review): a room's storage goes after ROOM_IDLE_DAYS with no
// connection; the one alarm slot is shared with the persist debounce.
describe('YRoom idle expiry', () => {
  const DAY = 86_400_000
  const flush = () => new Promise(r => setTimeout(r, 0))
  const textOf = (room: YRoom) => (room as unknown as { doc: Y.Doc }).doc.getText('t').toString()
  // The runtime consumes an alarm when it fires; the handler sets the next one.
  const fire = async (state: State, room: YRoom) => {
    state.consumeAlarm()
    await room.alarm()
  }
  const at = (t: number) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t)
  }

  async function leftAlone(env = { ROOM_IDLE_DAYS: '2' }) {
    const state = fakeState()
    const room = await wake(state, env)
    const a = connect(room)
    send(room, a, updateMessage('secret'))
    a.closedWith = 1000
    room.webSocketClose(a as unknown as WebSocket, 1000)
    await flush()
    return { state, room }
  }

  it('arms the idle clock on the last leave and deletes the room when it fires', async () => {
    const { state, room } = await leftAlone()
    const expireAt = state.data.get('expireAt') as number
    expect(expireAt - Date.now()).toBeGreaterThan(2 * DAY - 5_000)
    expect(state.alarmAt()).toBe(expireAt)
    expect(state.data.get('doc')).toBeInstanceOf(Uint8Array)

    at(expireAt + 1)
    await fire(state, room)
    expect([...state.data.keys()]).toEqual([])
    expect(state.alarmAt()).toBeNull()
    // The live object forgot the doc too: a joiner, or a wake, finds it empty.
    expect(textOf(room)).toBe('')
    expect(textOf(await wake(state))).toBe('')
  })

  it('keeps the room when someone joins before the deadline', async () => {
    const { state, room } = await leftAlone()
    const expireAt = state.data.get('expireAt') as number
    connect(room)
    await flush()
    expect(state.data.has('expireAt')).toBe(false)
    at(expireAt + 1)
    await fire(state, room)
    expect(textOf(await wake(state))).toBe('secret')
  })

  it('a past deadline never deletes a room someone is in', async () => {
    const state = fakeState()
    const room = await wake(state)
    const a = connect(room)
    send(room, a, updateMessage('in use'))
    await flush()
    state.data.set('expireAt', Date.now() - 1) // e.g. the join's delete has not landed
    await fire(state, room)
    expect(textOf(room)).toBe('in use')
    expect(state.data.get('doc')).toBeInstanceOf(Uint8Array)
    expect(a.closedWith).toBeNull()
  })

  it('an early alarm re-arms the idle clock it consumed', async () => {
    const { state, room } = await leftAlone()
    const expireAt = state.data.get('expireAt') as number
    await fire(state, room) // before the deadline, e.g. a persist alarm
    expect(state.data.has('doc')).toBe(true)
    expect(state.alarmAt()).toBe(expireAt)
  })

  it('a lone room with no deadline gets one when its alarm fires', async () => {
    // The last socket went without webSocketClose (deploy, runtime reset):
    // only the persist alarm is left, and no expireAt.
    const state = fakeState()
    const room = await wake(state, { ROOM_IDLE_DAYS: '2' })
    const a = connect(room)
    send(room, a, updateMessage('orphan'))
    a.closedWith = 1006
    await fire(state, room)
    const expireAt = state.data.get('expireAt') as number
    expect(expireAt - Date.now()).toBeGreaterThan(2 * DAY - 5_000)
    expect(state.alarmAt()).toBe(expireAt)
    expect(textOf(await wake(state))).toBe('orphan')
  })

  it('a doc too big to persist (L1) still expires', async () => {
    const state = fakeState()
    state.storage.put.mockImplementation(async (k: string, v: unknown) => {
      if (k === 'doc') throw new Error('value exceeds 2 MB')
      state.data.set(k, v)
    })
    const room = await wake(state)
    const a = connect(room)
    send(room, a, updateMessage('huge'))
    a.closedWith = 1000
    room.webSocketClose(a as unknown as WebSocket, 1000)
    await flush()
    expect(typeof state.data.get('expireAt')).toBe('number')
    expect(state.alarmAt()).toBe(state.data.get('expireAt'))
  })

  it('a wake does not re-persist or re-broadcast its own storage', async () => {
    const { state } = await leftAlone()
    state.storage.setAlarm.mockClear()
    const woken = await wake(state)
    expect(textOf(woken)).toBe('secret')
    expect(state.storage.setAlarm).not.toHaveBeenCalled()
  })

  it('defaults to 30 days and accepts fractions', async () => {
    const fresh = async (env: Record<string, string>) => {
      const { state } = await leftAlone(env as { ROOM_IDLE_DAYS: string })
      return Math.round(((state.data.get('expireAt') as number) - Date.now()) / 3_600_000)
    }
    expect(await fresh({})).toBe(30 * 24)
    expect(await fresh({ ROOM_IDLE_DAYS: 'junk' })).toBe(30 * 24)
    expect(await fresh({ ROOM_IDLE_DAYS: '0.5' })).toBe(12)
  })
})

describe('YRoom admin arm', () => {
  const post = (room: YRoom, action: string) =>
    room.fetch(new Request(`https://room/admin/${action}`, { method: 'POST' }))

  it('starts the idle clock once and leaves an earlier deadline alone', async () => {
    const state = fakeState()
    const room = await wake(state)
    expect(await (await post(room, 'arm')).text()).toBe('armed')
    const first = state.data.get('expireAt')
    expect(typeof first).toBe('number')
    await post(room, 'arm')
    expect(state.data.get('expireAt')).toBe(first)
  })

  it('leaves a room someone is in alone: the last leave arms it', async () => {
    const state = fakeState()
    const room = await wake(state)
    connect(room)
    expect(await (await post(room, 'arm')).text()).toMatch(/in use/)
    expect(state.data.has('expireAt')).toBe(false)
  })

  it('has no purge, and refuses anything but a POST', async () => {
    const room = await wake(fakeState())
    expect((await post(room, 'purge')).status).toBe(426)
    expect((await room.fetch(new Request('https://room/admin/arm'))).status).toBe(426)
  })
})

describe('front door /admin route', () => {
  const HEX = 'a'.repeat(64)
  function env(token?: string) {
    const roomFetch = vi.fn(async (r: Request) => new Response(`${r.method} ${new URL(r.url).pathname}`))
    const idFromString = vi.fn((hex: string) => {
      if (hex !== HEX) throw new Error('bad id')
      return hex
    })
    return {
      roomFetch,
      idFromString,
      ADMIN_TOKEN: token,
      AUTH_TOKEN: 'public-token',
      Y_ROOM: { idFromString, get: () => ({ fetch: roomFetch }) } as unknown as DurableObjectNamespace,
    }
  }
  const call = (e: ReturnType<typeof env>, path: string, auth?: string, method = 'POST') =>
    worker.fetch(new Request(`https://collab.example${path}`, { method, headers: auth ? { Authorization: auth } : {} }), e)

  it('is off without ADMIN_TOKEN', async () => {
    expect((await call(env(), `/admin/rooms/${HEX}/arm`, 'Bearer x')).status).toBe(404)
  })

  it('is off when ADMIN_TOKEN was set to the public AUTH_TOKEN', async () => {
    const e = env('public-token')
    expect((await call(e, `/admin/rooms/${HEX}/arm`, 'Bearer public-token')).status).toBe(404)
    expect(e.roomFetch).not.toHaveBeenCalled()
  })

  it('refuses a wrong secret, including the public AUTH_TOKEN', async () => {
    const e = env('s3cret')
    expect((await call(e, `/admin/rooms/${HEX}/arm`)).status).toBe(403)
    expect((await call(e, `/admin/rooms/${HEX}/arm`, 'Bearer public-token')).status).toBe(403)
    expect(e.roomFetch).not.toHaveBeenCalled()
  })

  it('only takes POST .../arm to a 64-hex id', async () => {
    const e = env('s3cret')
    expect((await call(e, `/admin/rooms/${HEX}/arm`, 'Bearer s3cret', 'GET')).status).toBe(404)
    expect((await call(e, `/admin/rooms/${HEX}/purge`, 'Bearer s3cret')).status).toBe(404)
    expect((await call(e, '/admin/rooms/my-room/arm', 'Bearer s3cret')).status).toBe(404)
    expect((await call(e, `/admin/rooms/${'b'.repeat(64)}/arm`, 'Bearer s3cret')).status).toBe(400)
    expect(e.roomFetch).not.toHaveBeenCalled()
  })

  it('forwards to the object named by its hex id', async () => {
    const e = env('s3cret')
    const res = await call(e, `/admin/rooms/${HEX}/arm`, 'Bearer s3cret')
    expect(await res.text()).toBe('POST /admin/arm')
    expect(e.idFromString).toHaveBeenCalledWith(HEX)
  })
})
