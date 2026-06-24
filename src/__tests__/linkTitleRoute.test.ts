/**
 * @jest-environment node
 *
 * SSRF guards for the link-title proxy. Pins three properties:
 *   - a target resolving to a non-public address is refused
 *   - the live request is pinned to the validated address (the pinned
 *     `lookup` fed to undici's Agent must answer with exactly the
 *     addresses that passed validation), closing the DNS-rebinding race
 *   - a redirect to a non-public host is refused rather than followed
 *
 * `undici` and `node:dns/promises` are mocked so no real network call
 * happens; `node:net`'s `isIP` is left real since it's pure string logic.
 */

import type { LookupFunction } from 'node:net'

const lookupMock = jest.fn()
jest.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }))

const fetchMock = jest.fn()
const agentCloseMock = jest.fn().mockResolvedValue(undefined)
let lastAgentLookup: LookupFunction | undefined
jest.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
  Agent: class {
    constructor(opts: { connect: { lookup: LookupFunction } }) {
      lastAgentLookup = opts.connect.lookup
    }
    close() {
      return agentCloseMock()
    }
  },
}))

import { GET } from '@/app/api/link-title/route'

let testIpCounter = 0

function makeRequest(targetUrl: string, ip?: string): Request {
  const url = new URL('http://localhost:3001/api/link-title')
  url.searchParams.set('url', targetUrl)
  return new Request(url, {
    headers: {
      origin: 'http://localhost:3001',
      'x-real-ip': ip ?? `10.0.1.${++testIpCounter}`,
    },
  })
}

function htmlResponse(title: string, status = 200): Response {
  return new Response(`<html><head><title>${title}</title></head></html>`, {
    status,
    headers: { 'content-type': 'text/html' },
  })
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

// Resolve a callback-style dns.lookup mock the way `dns.promises.lookup`
// would: with `{ all: true }`, it resolves to an address array.
function publicAddr(address: string, family = 4) {
  return [{ address, family }]
}

beforeEach(() => {
  lookupMock.mockReset()
  fetchMock.mockReset()
  agentCloseMock.mockClear()
  lastAgentLookup = undefined
})

describe('GET /api/link-title', () => {
  test('rejects a hostname that resolves to a private address', async () => {
    lookupMock.mockResolvedValue(publicAddr('10.0.0.5'))
    const res = await GET(makeRequest('http://internal.example.com/page'))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('rejects an IP-literal target in cloud-metadata space', async () => {
    const res = await GET(makeRequest('http://169.254.169.254/latest/meta-data/'))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(lookupMock).not.toHaveBeenCalled()
  })

  test('fetches and extracts the title for a public host, pinning the connection to the validated address', async () => {
    lookupMock.mockResolvedValue(publicAddr('93.184.216.34'))
    fetchMock.mockResolvedValue(htmlResponse('Example Domain'))

    const res = await GET(makeRequest('https://example.com/page'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe('Example Domain')

    // The Agent's lookup must answer with the validated address
    // regardless of what hostname it's asked about — this is the pin
    // that closes the TOCTOU/DNS-rebinding gap.
    expect(lastAgentLookup).toBeDefined()
    const cb = jest.fn()
    lastAgentLookup!('anything.invalid', { all: true }, cb)
    expect(cb).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
    expect(agentCloseMock).toHaveBeenCalledTimes(1)
  })

  test('does not auto-follow a redirect into private address space', async () => {
    lookupMock
      .mockResolvedValueOnce(publicAddr('93.184.216.34')) // public-facing redirector
      .mockResolvedValueOnce(publicAddr('127.0.0.1')) // redirect target resolves internal
    fetchMock.mockResolvedValueOnce(redirectResponse('http://internal.example.net/secret'))

    const res = await GET(makeRequest('https://public-redirector.example.com/go'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBeNull()
    // Only the first hop made a live request; the redirect target was
    // rejected during validation before a second fetch happened.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('re-validates and follows a redirect to another public host', async () => {
    lookupMock
      .mockResolvedValueOnce(publicAddr('93.184.216.34'))
      .mockResolvedValueOnce(publicAddr('93.184.216.40'))
    fetchMock
      .mockResolvedValueOnce(redirectResponse('https://www.example.com/page'))
      .mockResolvedValueOnce(htmlResponse('Final Title'))

    const res = await GET(makeRequest('https://example.com/page'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe('Final Title')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('gives up after too many redirect hops', async () => {
    lookupMock.mockResolvedValue(publicAddr('93.184.216.34'))
    fetchMock.mockImplementation(async () => redirectResponse('https://example.com/next'))

    const res = await GET(makeRequest('https://example.com/start'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBeNull()
    // MAX_REDIRECTS (5) initial hops + the one that trips the cap = 6 calls.
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  test('rejects cross-origin requests before any DNS lookup', async () => {
    const req = makeRequest('https://example.com/page')
    const crossOrigin = new Request(req.url, { headers: { origin: 'https://evil.example' } })
    const res = await GET(crossOrigin)
    expect(res.status).toBe(403)
    expect(lookupMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
