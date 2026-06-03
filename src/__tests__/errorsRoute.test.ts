/**
 * @jest-environment node
 *
 * /api/errors guards. Verifies the same shape as the other proxy
 * routes (subscribe / git-proxy): origin check, rate limit,
 * size cap, JSON sanity, payload sanitisation.
 */

import { POST } from '@/app/api/errors/route'

let testIpCounter = 0

function makeRequest(body: unknown, opts: { origin?: string; ip?: string; raw?: string } = {}): Request {
  const finalBody = opts.raw !== undefined ? opts.raw : typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('http://localhost/api/errors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: opts.origin ?? 'http://localhost:3001',
      'x-real-ip': opts.ip ?? `10.0.1.${++testIpCounter}`,
    },
    body: finalBody,
  })
}

describe('POST /api/errors', () => {
  let stderrSpy: jest.SpyInstance

  beforeEach(() => {
    // Quiet stderr so the test output stays clean — we only need to
    // assert the route returned ok.
    stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    stderrSpy.mockRestore()
  })

  test('accepts a well-formed error report', async () => {
    const res = await POST(makeRequest({
      kind: 'error',
      message: 'boom',
      stack: 'Error: boom\n  at foo',
      pathname: '/',
      ua: 'TestUA',
    }))
    expect(res.status).toBe(200)
    expect(stderrSpy).toHaveBeenCalledWith(
      '[noteser-client-error]',
      expect.stringContaining('"message":"boom"'),
    )
  })

  test('accepts a rejection report', async () => {
    const res = await POST(makeRequest({ kind: 'rejection', message: 'promise rejected' }))
    expect(res.status).toBe(200)
  })

  test('rejects when kind is unknown', async () => {
    const res = await POST(makeRequest({ kind: 'whoops', message: 'x' }))
    expect(res.status).toBe(400)
  })

  test('rejects empty message', async () => {
    const res = await POST(makeRequest({ kind: 'error', message: '' }))
    expect(res.status).toBe(400)
  })

  test('rejects non-JSON body', async () => {
    const res = await POST(makeRequest({}, { raw: 'not json' }))
    expect(res.status).toBe(400)
  })

  test('rejects payload larger than 32 KB', async () => {
    const huge = 'x'.repeat(40_000)
    const res = await POST(makeRequest({}, { raw: huge }))
    expect(res.status).toBe(413)
  })

  test('truncates an oversized stack to 8 KB', async () => {
    const big = 'a'.repeat(20_000)
    await POST(makeRequest({ kind: 'error', message: 'boom', stack: big }))
    const logged = stderrSpy.mock.calls[0]?.[1] as string | undefined
    expect(logged).toBeDefined()
    const parsed = JSON.parse(logged!) as { stack?: string }
    expect(parsed.stack?.length).toBeLessThanOrEqual(8 * 1024)
  })

  test('rejects cross-origin', async () => {
    const res = await POST(makeRequest(
      { kind: 'error', message: 'x' },
      { origin: 'https://evil.example' },
    ))
    expect(res.status).toBe(403)
  })

  test('rate-limits after 30 reports in the window', async () => {
    const ip = '203.0.113.42'
    let last: Response | null = null
    for (let i = 0; i < 31; i++) {
      last = await POST(makeRequest({ kind: 'error', message: `e${i}` }, { ip }))
    }
    expect(last?.status).toBe(429)
  })

  test('preserves the pluginId when present', async () => {
    await POST(makeRequest({ kind: 'error', message: 'plugin boom', pluginId: 'noteser-word-count' }))
    const logged = stderrSpy.mock.calls[0]?.[1] as string | undefined
    expect(logged).toBeDefined()
    expect(logged!).toContain('"pluginId":"noteser-word-count"')
  })
})
