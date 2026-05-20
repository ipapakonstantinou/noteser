/**
 * @jest-environment node
 *
 * githubFetch.test.ts
 *
 * Verifies the retry wrapper around fetch:
 *   - 429 + Retry-After honoured
 *   - 5xx → exponential backoff
 *   - Non-transient statuses returned immediately
 *   - Network errors retried up to maxRetries
 *   - computeWait helper respects Retry-After and falls back to backoff
 *
 * Uses the `node` test environment so the global Fetch API (Response,
 * Headers, Request) is available — jsdom drops these.
 */

import { githubFetch, computeWait } from '../utils/githubFetch'

function makeRes(status: number, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers)
  return new Response(null, { status, headers: h })
}

describe('githubFetch — retry behaviour', () => {
  test('returns immediately on 200', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeRes(200))
    global.fetch = fetchMock as unknown as typeof fetch
    const delays: number[] = []

    const res = await githubFetch('https://example.com', undefined, {
      delayMs: async (ms) => { delays.push(ms) },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(delays).toEqual([])
  })

  test('returns immediately on a non-transient error (404)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeRes(404))
    global.fetch = fetchMock as unknown as typeof fetch
    const res = await githubFetch('https://example.com', undefined, {
      delayMs: async () => {},
    })
    expect(res.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('retries on 429 then succeeds', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeRes(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(makeRes(200))
    global.fetch = fetchMock as unknown as typeof fetch
    const delays: number[] = []

    const res = await githubFetch('https://example.com', undefined, {
      delayMs: async (ms) => { delays.push(ms) },
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([1000])
  })

  test('honours Retry-After header (seconds)', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeRes(429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(makeRes(200))
    global.fetch = fetchMock as unknown as typeof fetch
    const delays: number[] = []
    await githubFetch('https://example.com', undefined, {
      delayMs: async (ms) => { delays.push(ms) },
    })
    expect(delays[0]).toBe(3000)
  })

  test('falls back to backoff when Retry-After is absent', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeRes(503))   // no retry-after
      .mockResolvedValueOnce(makeRes(200))
    global.fetch = fetchMock as unknown as typeof fetch
    const delays: number[] = []
    await githubFetch('https://example.com', undefined, {
      delayMs: async (ms) => { delays.push(ms) },
    })
    // First backoff attempt is ~500ms ± jitter.
    expect(delays).toHaveLength(1)
    expect(delays[0]).toBeGreaterThan(0)
    expect(delays[0]).toBeLessThan(1000)
  })

  test('gives up after maxRetries and returns the last transient response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeRes(503))
    global.fetch = fetchMock as unknown as typeof fetch
    const res = await githubFetch('https://example.com', undefined, {
      delayMs: async () => {},
      maxRetries: 2,
    })
    expect(res.status).toBe(503)
    // 1 initial + 2 retries = 3.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('retries on network error then throws if it persists', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('NetworkError'))
    global.fetch = fetchMock as unknown as typeof fetch
    await expect(
      githubFetch('https://example.com', undefined, {
        delayMs: async () => {},
        maxRetries: 1,
      })
    ).rejects.toThrow('NetworkError')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('retries on network error then succeeds', async () => {
    const fetchMock = jest.fn()
      .mockRejectedValueOnce(new TypeError('flaky'))
      .mockResolvedValueOnce(makeRes(200))
    global.fetch = fetchMock as unknown as typeof fetch
    const res = await githubFetch('https://example.com', undefined, {
      delayMs: async () => {},
    })
    expect(res.status).toBe(200)
  })
})

describe('computeWait', () => {
  test('reads Retry-After in seconds', () => {
    const res = makeRes(429, { 'retry-after': '5' })
    expect(computeWait(res, 0)).toBe(5000)
  })

  test('reads X-RateLimit-Reset (epoch seconds) when present and Retry-After missing', () => {
    const futureEpoch = Math.floor(Date.now() / 1000) + 3 // 3 seconds out
    const res = makeRes(403, { 'x-ratelimit-reset': String(futureEpoch) })
    const w = computeWait(res, 0)
    // Epoch arithmetic rounds down to the second — Date.now() can be up to
    // ~1s past `futureEpoch * 1000 - 3000`. Generous bounds keep this stable.
    expect(w).toBeGreaterThanOrEqual(2000)
    expect(w).toBeLessThanOrEqual(3500)
  })

  test('falls back to backoff when no rate-limit headers', () => {
    const res = makeRes(500)
    const w0 = computeWait(res, 0)
    const w2 = computeWait(res, 2)
    expect(w0).toBeGreaterThan(0)
    // Attempt 2 should be larger than attempt 0 (modulo jitter).
    expect(w2).toBeGreaterThan(w0 / 2)
  })

  test('caps the wait at 30 seconds', () => {
    const res = makeRes(429, { 'retry-after': '9999' })
    expect(computeWait(res, 0)).toBe(30_000)
  })
})
