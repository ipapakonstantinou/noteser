// Abuse-limit policy for the collab server, kept separate from index.ts so
// it can be unit-tested without a Durable Object / WebSocket runtime.
//
// Context: a room has no auth beyond the optional shared AUTH_TOKEN (see
// index.ts), so any client holding a room id can currently open unlimited
// connections, send unbounded-size frames, and flood messages — all of
// which either bloat Durable Object storage or burn CPU on every peer in
// the room. These three checks bound that blast radius; they do not make
// the room private (that's the token/room-id's job).

export interface LimitsConfig {
  // Reject/close a connection that sends a single frame larger than this.
  maxMessageBytes: number
  // Reject new connections once a room already holds this many sockets.
  maxConnectionsPerRoom: number
  // Sliding-window cap: at most this many messages per connection per
  // `windowMs`. Exceeding it closes the connection as abusive.
  maxMessagesPerWindow: number
  windowMs: number
}

export const DEFAULT_LIMITS: LimitsConfig = {
  maxMessageBytes: 1_000_000, // 1 MB — comfortably above a real Yjs update
  maxConnectionsPerRoom: 20,
  maxMessagesPerWindow: 200,
  windowMs: 1_000,
}

// Subset of the Worker Env this module cares about — kept as `string`
// (wrangler vars/secrets are always strings) rather than importing the
// full Env from index.ts, so this file has no Durable-Object dependency.
export interface LimitsEnv {
  MAX_MESSAGE_BYTES?: string
  MAX_CONNECTIONS_PER_ROOM?: string
  MAX_MESSAGES_PER_WINDOW?: string
  WINDOW_MS?: string
}

function positiveIntOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Reads optional overrides from wrangler vars, falling back to
// DEFAULT_LIMITS for anything unset or malformed.
export function resolveLimits(env: LimitsEnv): LimitsConfig {
  return {
    maxMessageBytes: positiveIntOr(env.MAX_MESSAGE_BYTES, DEFAULT_LIMITS.maxMessageBytes),
    maxConnectionsPerRoom: positiveIntOr(
      env.MAX_CONNECTIONS_PER_ROOM,
      DEFAULT_LIMITS.maxConnectionsPerRoom,
    ),
    maxMessagesPerWindow: positiveIntOr(
      env.MAX_MESSAGES_PER_WINDOW,
      DEFAULT_LIMITS.maxMessagesPerWindow,
    ),
    windowMs: positiveIntOr(env.WINDOW_MS, DEFAULT_LIMITS.windowMs),
  }
}

export function isMessageTooLarge(byteLength: number, limits: LimitsConfig): boolean {
  return byteLength > limits.maxMessageBytes
}

export function isRoomFull(currentConnections: number, limits: LimitsConfig): boolean {
  return currentConnections >= limits.maxConnectionsPerRoom
}

// Sliding-window message-rate limiter — one instance per connection.
export class MessageRateLimiter {
  private timestamps: number[] = []

  constructor(private readonly limits: LimitsConfig) {}

  // Records one message at `now` and reports whether it's within the
  // allowed rate. Once it returns false, the caller should treat the
  // connection as abusive (e.g. close it) — this does not "hold" the
  // message, it only classifies it.
  allow(now: number = Date.now()): boolean {
    const cutoff = now - this.limits.windowMs
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) this.timestamps.shift()
    if (this.timestamps.length >= this.limits.maxMessagesPerWindow) return false
    this.timestamps.push(now)
    return true
  }
}
