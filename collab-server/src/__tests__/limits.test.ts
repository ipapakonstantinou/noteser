// Unit tests for the collab-server abuse limits (src/limits.ts).
//
// This is the fix for the "zero tests" finding of the 2026-07-06 security
// review: collab-server had no *.test.* files at all. These cover the pure
// policy layer directly — no Durable Object / WebSocket runtime needed,
// which is exactly why that logic lives in its own module.
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LIMITS,
  isMessageTooLarge,
  isRoomFull,
  MessageRateLimiter,
  resolveLimits,
} from '../limits'

describe('resolveLimits', () => {
  it('falls back to DEFAULT_LIMITS when env is empty', () => {
    expect(resolveLimits({})).toEqual(DEFAULT_LIMITS)
  })

  it('applies valid overrides from env vars', () => {
    const limits = resolveLimits({
      MAX_MESSAGE_BYTES: '2048',
      MAX_CONNECTIONS_PER_ROOM: '5',
      MAX_MESSAGES_PER_WINDOW: '10',
      WINDOW_MS: '500',
    })
    expect(limits).toEqual({
      maxMessageBytes: 2048,
      maxConnectionsPerRoom: 5,
      maxMessagesPerWindow: 10,
      windowMs: 500,
    })
  })

  it('ignores malformed/non-positive overrides and falls back per-field', () => {
    const limits = resolveLimits({
      MAX_MESSAGE_BYTES: 'not-a-number',
      MAX_CONNECTIONS_PER_ROOM: '0',
      MAX_MESSAGES_PER_WINDOW: '-5',
      // WINDOW_MS left unset entirely
    })
    expect(limits).toEqual(DEFAULT_LIMITS)
  })
})

describe('isMessageTooLarge', () => {
  const limits = { ...DEFAULT_LIMITS, maxMessageBytes: 100 }

  it('allows a message at or under the cap', () => {
    expect(isMessageTooLarge(100, limits)).toBe(false)
    expect(isMessageTooLarge(50, limits)).toBe(false)
  })

  it('rejects a message over the cap', () => {
    expect(isMessageTooLarge(101, limits)).toBe(true)
  })
})

describe('isRoomFull', () => {
  const limits = { ...DEFAULT_LIMITS, maxConnectionsPerRoom: 3 }

  it('is not full below the cap', () => {
    expect(isRoomFull(0, limits)).toBe(false)
    expect(isRoomFull(2, limits)).toBe(false)
  })

  it('is full at or above the cap', () => {
    expect(isRoomFull(3, limits)).toBe(true)
    expect(isRoomFull(4, limits)).toBe(true)
  })
})

describe('MessageRateLimiter', () => {
  it('allows messages up to the window cap', () => {
    const limiter = new MessageRateLimiter({ ...DEFAULT_LIMITS, maxMessagesPerWindow: 3, windowMs: 1000 })
    expect(limiter.allow(0)).toBe(true)
    expect(limiter.allow(0)).toBe(true)
    expect(limiter.allow(0)).toBe(true)
  })

  it('denies once the cap is exceeded within the window', () => {
    const limiter = new MessageRateLimiter({ ...DEFAULT_LIMITS, maxMessagesPerWindow: 2, windowMs: 1000 })
    expect(limiter.allow(0)).toBe(true)
    expect(limiter.allow(0)).toBe(true)
    expect(limiter.allow(0)).toBe(false)
  })

  it('recovers once old timestamps slide out of the window', () => {
    const limiter = new MessageRateLimiter({ ...DEFAULT_LIMITS, maxMessagesPerWindow: 1, windowMs: 1000 })
    expect(limiter.allow(0)).toBe(true)
    expect(limiter.allow(500)).toBe(false) // still inside the 1000ms window
    expect(limiter.allow(1001)).toBe(true) // the t=0 hit has aged out
  })

  it('tracks each connection independently (fresh instance per socket)', () => {
    const limits = { ...DEFAULT_LIMITS, maxMessagesPerWindow: 1, windowMs: 1000 }
    const a = new MessageRateLimiter(limits)
    const b = new MessageRateLimiter(limits)
    expect(a.allow(0)).toBe(true)
    expect(a.allow(0)).toBe(false)
    expect(b.allow(0)).toBe(true) // unaffected by `a`'s state
  })
})
