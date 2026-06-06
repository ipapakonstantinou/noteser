/**
 * @jest-environment node
 *
 * git-proxy CORS preflight guard (#28). The OPTIONS handler used to echo
 * a permissive `Access-Control-Allow-Origin: *` regardless of the caller.
 * It now mirrors the GET/POST origin guard: echo the *validated* origin on
 * success, refuse with a bare 403 (no CORS headers) otherwise.
 *
 * Runs in the node environment so the Web Request/Response globals are
 * visible to Next's spec-extension layer.
 */

import { OPTIONS } from '@/app/api/git-proxy/[...path]/route'
import type { NextRequest } from 'next/server'

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost:3001/api/git-proxy/github.com/o/r.git/info/refs', {
    method: 'OPTIONS',
    headers,
  }) as unknown as NextRequest
}

describe('OPTIONS /api/git-proxy', () => {
  test('allowed origin → 204 echoing that exact origin (never *)', async () => {
    const res = await OPTIONS(makeRequest({ origin: 'http://localhost:3001' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001')
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
    expect(res.headers.get('Vary')).toBe('Origin')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS')
  })

  test('disallowed origin → 403 with no CORS headers', async () => {
    const res = await OPTIONS(makeRequest({ origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('missing Origin/Referer → 403', async () => {
    const res = await OPTIONS(makeRequest())
    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
