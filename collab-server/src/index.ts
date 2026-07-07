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
// debounced while clients type and flushed when the last one leaves —
// a room survives eviction/hibernation of the object. Note bodies are
// ALSO still synced to GitHub by the app itself; this store only keeps
// live sessions converging, it is not the source of truth.

import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

import { isMessageTooLarge, isRoomFull, MessageRateLimiter, resolveLimits, type LimitsEnv } from './limits'

export interface Env extends LimitsEnv {
  Y_ROOM: DurableObjectNamespace
  // Optional shared secret. When set, connections must carry it as the
  // path segment BEFORE the room: wss://<host>/<AUTH_TOKEN>/<room>.
  // Configure with `npx wrangler secret put AUTH_TOKEN` and bake the
  // same value into NEXT_PUBLIC_YJS_WS_URL (= wss://<host>/<token>).
  AUTH_TOKEN?: string
}

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

// Front door: validate the path, then hand the WebSocket upgrade to the
// room's Durable Object. y-websocket appends "/<room>" to the base URL,
// so the room is always the LAST path segment.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('noteser collab server — connect with a y-websocket client.', {
        status: 200,
      })
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

const PERSIST_DEBOUNCE_MS = 3_000

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

export class YRoom {
  private readonly state: DurableObjectState
  private readonly doc = new Y.Doc()
  private readonly awareness: awarenessProtocol.Awareness
  private readonly limits: ReturnType<typeof resolveLimits>
  // socket → awareness client ids announced over it, so a disconnect can
  // clear exactly that peer's cursors for everyone else.
  private readonly conns = new Map<WebSocket, Set<number>>()
  // socket → its own message-rate window. Per-connection so one abusive
  // peer can't burn through the budget of everyone else in the room.
  private readonly rateLimiters = new Map<WebSocket, MessageRateLimiter>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.limits = resolveLimits(env)
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null) // the server is not a participant

    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get('doc')
      if (stored instanceof Uint8Array) Y.applyUpdate(this.doc, stored)
    })

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      // The originating socket already has this update — skip it.
      this.broadcast(encoding.toUint8Array(encoder), origin)
      this.schedulePersist()
    })

    this.awareness.on('update', (change: AwarenessChange, origin: unknown) => {
      const { added, updated, removed } = change
      if (origin instanceof WebSocket) {
        const owned = this.conns.get(origin)
        if (owned) {
          for (const id of added.concat(updated)) owned.add(id)
          for (const id of removed) owned.delete(id)
        }
      }
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
      return new Response('Expected WebSocket', { status: 426 })
    }
    // Cap concurrent sockets per room so one client can't force unbounded
    // fan-out/storage growth by opening connections in a loop.
    if (isRoomFull(this.conns.size, this.limits)) {
      return new Response('Room is full', { status: 429 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.accept(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  private accept(ws: WebSocket): void {
    ws.accept()
    this.conns.set(ws, new Set())
    this.rateLimiters.set(ws, new MessageRateLimiter(this.limits))

    ws.addEventListener('message', event => {
      if (!(event.data instanceof ArrayBuffer)) return
      if (isMessageTooLarge(event.data.byteLength, this.limits)) {
        ws.close(1009, 'Message too large')
        return
      }
      if (this.rateLimiters.get(ws)?.allow() === false) {
        ws.close(1008, 'Rate limit exceeded')
        return
      }
      try {
        this.handleMessage(ws, new Uint8Array(event.data))
      } catch {
        // A malformed frame must not take the room down with it.
      }
    })
    const drop = () => this.dropConnection(ws)
    ws.addEventListener('close', drop)
    ws.addEventListener('error', drop)

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

  private dropConnection(ws: WebSocket): void {
    const owned = this.conns.get(ws)
    if (!owned) return // already dropped (close + error both fire)
    this.conns.delete(ws)
    this.rateLimiters.delete(ws)
    if (owned.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...owned], null)
    }
    if (this.conns.size === 0) void this.persistNow()
  }

  private broadcast(payload: Uint8Array, exclude: unknown): void {
    for (const ws of this.conns.keys()) {
      if (ws === exclude) continue
      try {
        ws.send(payload)
      } catch {
        this.dropConnection(ws)
      }
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistNow()
    }, PERSIST_DEBOUNCE_MS)
  }

  private async persistNow(): Promise<void> {
    await this.state.storage.put('doc', Y.encodeStateAsUpdate(this.doc))
  }
}
