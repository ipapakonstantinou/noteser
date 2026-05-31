/**
 * @jest-environment node
 *
 * Subscribe route guards. The route delegates the actual signup to
 * Buttondown; this test pins the input-validation + auth layer that
 * runs BEFORE the upstream call, so a bad request never reaches
 * Buttondown's API quota.
 *
 * Runs in the node environment (not jsdom) so the Web Request/Response
 * globals from Node 22 are visible to Next's spec-extension layer.
 */

import { POST } from '@/app/api/subscribe/route'

// The rate limiter buckets by IP at module scope, so each test uses a
// unique `x-real-ip` to start with a fresh bucket. Otherwise the 6th
// call across all tests gets a 429.
let testIpCounter = 0

function makeRequest(body: unknown, opts: { origin?: string; ip?: string } = {}): Request {
  return new Request('http://localhost/api/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: opts.origin ?? 'http://localhost:3001',
      'x-real-ip': opts.ip ?? `10.0.0.${++testIpCounter}`,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/subscribe', () => {
  const origEnv = process.env.BUTTONDOWN_API_KEY
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    process.env.BUTTONDOWN_API_KEY = 'test-key'
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({}), { status: 201 }),
    )
  })

  afterEach(() => {
    process.env.BUTTONDOWN_API_KEY = origEnv
    fetchSpy.mockRestore()
  })

  test('rejects request with no email', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('rejects malformed email', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('rejects 255+ char email (RFC 5321 cap)', async () => {
    const huge = 'a'.repeat(250) + '@b.co'
    const res = await POST(makeRequest({ email: huge }))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('rejects cross-origin request', async () => {
    const res = await POST(makeRequest({ email: 'a@b.co' }, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('returns 500 when API key not configured', async () => {
    delete process.env.BUTTONDOWN_API_KEY
    const res = await POST(makeRequest({ email: 'a@b.co' }))
    expect(res.status).toBe(500)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('forwards valid email to Buttondown with tag', async () => {
    const res = await POST(makeRequest({ email: 'a@b.co', source: 'site-landing' }))
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.buttondown.com/v1/subscribers')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Token test-key')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ email_address: 'a@b.co', tags: ['site-landing'] })
  })

  test('treats "already subscribed" as success', async () => {
    fetchSpy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ code: 'email_already_exists', detail: 'taken' }), { status: 400 }),
    )
    const res = await POST(makeRequest({ email: 'a@b.co' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; alreadySubscribed: boolean }
    expect(data.ok).toBe(true)
    expect(data.alreadySubscribed).toBe(true)
  })

  test('masks upstream errors as 502', async () => {
    fetchSpy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ detail: 'internal buttondown blowup' }), { status: 500 }),
    )
    const res = await POST(makeRequest({ email: 'a@b.co' }))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('buttondown blowup')
  })
})
