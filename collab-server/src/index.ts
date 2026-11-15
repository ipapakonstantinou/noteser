// noteser live-collaboration server — a y-websocket-compatible sync
// endpoint on Cloudflare Workers + Durable Objects.
//
// The noteser client already speaks this protocol: collabExtension.ts
// opens `new WebsocketProvider(NEXT_PUBLIC_YJS_WS_URL, room, doc)`,
// which connects to `<url>/<room>`. This worker routes each room to its
// own Durable Object instance, where the shared Y.Doc, the awareness
// states (remote cursors), and the connected sockets live together.
//
// Wire protocol (identical to the reference y-websocket server):
//   varUint messageType, then payload.
//   0 = sync     y-protocols/sync: step1 / step2 / update
//   1 = awareness y-protocols/awareness update (cursor presence)
// Unknown message types are ignored so future client additions don't
// break older deployments.
//
// Persistence: the doc is folded into Durable Object storage (SQLite),
// debounced via a DO alarm while clients type and flushed when the last
// one leaves —
// a room survives eviction/hibernation of the object. Note bodies are
// ALSO still synced to GitHub by the app itself; this store only keeps
// live sessions converging, it is not the source of truth.
//
// Lifecycle: when the last socket leaves, the same alarm is re-armed for
// ROOM_IDLE_DAYS later; if nobody has joined by then the room's storage is
// deleted. A later joiner finds an empty room and re-seeds it from its note.

import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

import { isMessageTooLarge, isRoomFull, MessageRateLimiter, resolveLimits, type LimitsEnv } from './limits'

export interface Env extends LimitsEnv {
  Y_ROOM: DurableObjectNamespace
  // Days a room may sit with no connection before its storage is deleted
  // (default 30). Fractions work, for testing.
  ROOM_IDLE_DAYS?: string
  // Secret for the one-off /admin arm sweep of rooms stored before the idle
  // alarm. Unset, or equal to AUTH_TOKEN, = the route answers 404.
  ADMIN_TOKEN?: string
  // Optional shared secret. When set, connections must carry it as the
  // path segment BEFORE the room: wss://<host>/<AUTH_TOKEN>/<room>.
  // Configure with `npx wrangler secret put AUTH_TOKEN` and bake the
  // same value into NEXT_PUBLIC_YJS_WS_URL (= wss://<host>/<token>).
  AUTH_TOKEN?: string
  // Browser origins allowed to open a socket, space/comma separated; `*`
  // stands for one run of [a-z0-9] (no hyphen, no dot). Unset = no check.
  ALLOWED_ORIGINS?: string
}

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

// CSWSH guard, not auth: browsers always send Origin on a WebSocket
// handshake and a page cannot remove it, so a missing header is a
// non-browser client (which could forge any value anyway) and passes.
// `Origin: null` (sandboxed iframe, file:, data:) is a page and fails.
export function isOriginAllowed(origin: string | null, allowed: string | undefined): boolean {
  const patterns = (allowed ?? '').split(/[\s,]+/).filter(Boolean)
  if (patterns.length === 0 || origin === null) return true
  const o = origin.toLowerCase()
  return patterns.some(p =>
    new RegExp(
      '^' + p.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, c => (c === '*' ? '[a-z0-9]+' : '\\' + c)) + '$',
    ).test(o),
  )
}

// Front door: validate the path, then hand the WebSocket upgrade to the
// room's Durable Object. y-websocket appends "/<room>" to the base URL,
// so the room is always the LAST path segment.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/admin/')) return admin(request, env)
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('noteser collab server — connect with a y-websocket client.', {
        status: 200,
      })
    }
    if (!isOriginAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
      return new Response('Forbidden origin', { status: 403 })
    }
    const segments = new URL(request.url).pathname.split('/').filter(Boolean)
    const room = segments.length > 0 ? segments[segments.length - 1] : null
    if (!room) return new Response('Missing room', { status: 400 })
    if (env.AUTH_TOKEN) {
      const token = segments.length >= 2 ? segments[segments.length - 2] : null
      if (token !== env.AUTH_TOKEN) return new Response('Forbidden', { status: 403 })
    }
    const id = env.Y_ROOM.idFromName(room)
    return env.Y_ROOM.get(id).fetch(request)
  },
}

// POST /admin/rooms/<object id>/arm, Authorization: Bearer ADMIN_TOKEN: wakes
// one Durable Object by its hex id (as the Cloudflare API lists it) and starts
// its idle clock. A mis-set secret equal to the public AUTH_TOKEN keeps it off.
async function admin(request: Request, env: Env): Promise<Response> {
  const m = /^\/admin\/rooms\/([0-9a-f]{64})\/arm$/.exec(new URL(request.url).pathname)
  const off = !env.ADMIN_TOKEN || env.ADMIN_TOKEN === env.AUTH_TOKEN
  if (off || !m || request.method !== 'POST') return new Response('Not found', { status: 404 })
  if (!sameSecret(request.headers.get('Authorization') ?? '', `Bearer ${env.ADMIN_TOKEN}`)) {
    return new Response('Forbidden', { status: 403 })
  }
  let id: DurableObjectId
  try {
    id = env.Y_ROOM.idFromString(m[1])
  } catch {
    return new Response('Bad id', { status: 400 })
  }
  return env.Y_ROOM.get(id).fetch(new Request('https://room/admin/arm', { method: 'POST' }))
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const PERSIST_DEBOUNCE_MS = 3_000
const DAY_MS = 86_400_000
const FROM_STORAGE = Symbol('storage')

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

// Per-socket state that must survive hibernation (in-memory fields don't).
// `awareness` is that peer's encoded awareness update, so a woken room can
// still show its cursors to a joiner and clear them when it disconnects.
interface Attachment {
  ids: number[]
  awareness: Uint8Array | null
}

function readAttachment(ws: WebSocket): Attachment {
  return (ws.deserializeAttachment() as Attachment | null) ?? { ids: [], awareness: null }
}

// Uses the WebSocket Hibernation API: the runtime holds the sockets and
// evicts the object while the room is idle, so an open-but-quiet tab no
// longer bills Durable Object duration. On wake the constructor reruns:
// the doc reloads from storage, presence rebuilds from socket attachments.
export class YRoom {
  private readonly state: DurableObjectState
  private doc!: Y.Doc
  private awareness!: awarenessProtocol.Awareness
  private readonly limits: ReturnType<typeof resolveLimits>
  private readonly idleMs: number
  // ponytail: rate windows live in memory, so a wake resets them; move them
  // into the attachment if a flood spanning hibernations ever matters.
  private readonly rateLimiters = new Map<WebSocket, MessageRateLimiter>()
  private persistScheduled = false

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.limits = resolveLimits(env)
    const days = Number(env.ROOM_IDLE_DAYS)
    this.idleMs = (Number.isFinite(days) && days > 0 ? days : 30) * DAY_MS
    this.load()

    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get('doc')
      if (stored instanceof Uint8Array) Y.applyUpdate(this.doc, stored, FROM_STORAGE)
    })

    // Rebuild presence before the handlers are attached, so a wake doesn't
    // re-broadcast every cursor.
    for (const ws of state.getWebSockets()) {
      const att = readAttachment(ws)
      if (att.awareness) awarenessProtocol.applyAwarenessUpdate(this.awareness, att.awareness, ws)
    }
    this.wire()
  }

  private load(): void {
    this.doc = new Y.Doc()
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    // Its 3s outdated-state timer would pin the object in memory forever.
    // Peers' states are removed on socket close instead.
    clearInterval(this.awareness._checkInterval)
    this.awareness.setLocalState(null) // the server is not a participant
  }

  private wire(): void {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Our own storage reloaded on wake: peers already have it, nothing to persist.
      if (origin === FROM_STORAGE) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      // The originating socket already has this update — skip it.
      this.broadcast(encoding.toUint8Array(encoder), origin)
      this.schedulePersist()
    })

    this.awareness.on('update', (change: AwarenessChange, origin: unknown) => {
      const { added, updated, removed } = change
      if (origin) this.saveOwnedAwareness(origin as WebSocket, change)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, added.concat(updated, removed)),
      )
      // Everyone hears about cursor changes, INCLUDING the origin — the
      // reference server does the same and the client dedupes.
      this.broadcast(encoding.toUint8Array(encoder), null)
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      // Only the front door's authenticated /admin route sends these.
      if (request.method === 'POST' && request.url.endsWith('/admin/arm')) return this.adminArm()
      return new Response('Expected WebSocket', { status: 426 })
    }
    // Cap concurrent sockets per room so one client can't force unbounded
    // fan-out/storage growth by opening connections in a loop.
    if (isRoomFull(this.state.getWebSockets().length, this.limits)) {
      return new Response('Room is full', { status: 429 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.accept(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  private accept(ws: WebSocket): void {
    this.state.acceptWebSocket(ws)
    ws.serializeAttachment({ ids: [], awareness: null } satisfies Attachment)
    void this.state.storage.delete('expireAt') // someone is here: stop the idle clock

    // Sync step 1: send our state vector so the client replies with what
    // we're missing; the client sends its own step 1 symmetrically.
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    ws.send(encoding.toUint8Array(encoder))

    // Current presence, so a joiner immediately sees existing cursors.
    const states = this.awareness.getStates()
    if (states.size > 0) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      )
      ws.send(encoding.toUint8Array(enc))
    }
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (!(message instanceof ArrayBuffer)) return
    if (isMessageTooLarge(message.byteLength, this.limits)) {
      ws.close(1009, 'Message too large')
      return
    }
    let limiter = this.rateLimiters.get(ws)
    if (!limiter) this.rateLimiters.set(ws, (limiter = new MessageRateLimiter(this.limits)))
    if (!limiter.allow()) {
      ws.close(1008, 'Rate limit exceeded')
      return
    }
    try {
      this.handleMessage(ws, new Uint8Array(message))
    } catch {
      // A malformed frame must not take the room down with it.
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    this.dropConnection(ws)
    try {
      ws.close(code) // finish the close handshake (compat date < 2026-04-07)
    } catch {
      // 1005/1006 can't be echoed back; the socket is gone either way.
    }
  }

  webSocketError(ws: WebSocket): void {
    this.dropConnection(ws)
  }

  async alarm(): Promise<void> {
    this.persistScheduled = false
    if (this.state.getWebSockets().length === 0) {
      const expireAt = await this.state.storage.get('expireAt')
      if (typeof expireAt !== 'number') {
        await this.armIdleExpiry() // the last socket went without a close (deploy, reset)
      } else if (Date.now() >= expireAt) {
        return this.wipe()
      } else {
        await this.state.storage.setAlarm(expireAt) // an early alarm must not lose the idle clock
      }
    }
    await this.persistNow()
  }

  private async adminArm(): Promise<Response> {
    if (this.state.getWebSockets().length > 0) return new Response('in use, the last leave arms it')
    if (typeof (await this.state.storage.get('expireAt')) !== 'number') await this.armIdleExpiry()
    return new Response('armed')
  }

  // Only with no sockets: the in-memory doc is replaced, so nobody resyncs from it.
  private async wipe(): Promise<void> {
    await this.state.storage.deleteAll()
    await this.state.storage.deleteAlarm()
    this.persistScheduled = false
    // Replaced, not destroyed: destroy() emits a 'local' awareness update into our handler.
    this.load()
    this.wire()
  }

  // Replaces any pending persist alarm; dropConnection flushes the doc first.
  private async armIdleExpiry(): Promise<void> {
    const at = Date.now() + this.idleMs
    this.persistScheduled = false
    await this.state.storage.put('expireAt', at)
    await this.state.storage.setAlarm(at)
  }

  private handleMessage(ws: WebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data)
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        // Applies updates to the doc (origin = ws, so the broadcast in the
        // doc handler skips the sender) and/or assembles a reply.
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws)
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder))
        break
      }
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        )
        break
      default:
        break // unknown message kind — ignore
    }
  }

  // Track which awareness client ids this socket announced (so a disconnect
  // clears exactly its cursors) plus their encoded state for a wake.
  private saveOwnedAwareness(ws: WebSocket, { added, updated, removed }: AwarenessChange): void {
    const owned = new Set(readAttachment(ws).ids)
    for (const id of added.concat(updated)) owned.add(id)
    for (const id of removed) owned.delete(id)
    const ids = [...owned]
    const live = ids.filter(id => this.awareness.states.has(id))
    const awareness = live.length > 0 ? awarenessProtocol.encodeAwarenessUpdate(this.awareness, live) : null
    try {
      ws.serializeAttachment({ ids, awareness } satisfies Attachment)
    } catch {
      // Over the 16 KB attachment cap: keep the ids, lose presence on wake.
      ws.serializeAttachment({ ids, awareness: null } satisfies Attachment)
    }
  }

  // Idempotent: close and error can both fire for one socket.
  private dropConnection(ws: WebSocket): void {
    this.rateLimiters.delete(ws)
    const owned = readAttachment(ws).ids
    if (owned.length > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, owned, null)
    }
    if (this.state.getWebSockets().every(other => other === ws)) {
      void this.persistNow().catch(err => console.error('[collab] persist failed', err))
      // Separate from the persist: a doc over the 2 MB value cap fails to
      // persist (L1) but must still expire.
      void this.armIdleExpiry()
    }
  }

  private broadcast(payload: Uint8Array, exclude: unknown): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue
      try {
        ws.send(payload)
      } catch {
        // Dead socket: the runtime delivers webSocketClose/Error for it.
      }
    }
  }

  // An alarm, not setTimeout: a pending timer pins the object in memory.
  // ponytail: edits from the last <3s are lost if the object is evicted
  // before the alarm fires; clients re-send them on their next sync.
  private schedulePersist(): void {
    if (this.persistScheduled) return
    this.persistScheduled = true
    void this.state.storage.setAlarm(Date.now() + PERSIST_DEBOUNCE_MS)
  }

  private async persistNow(): Promise<void> {
    await this.state.storage.put('doc', Y.encodeStateAsUpdate(this.doc))
  }
}
