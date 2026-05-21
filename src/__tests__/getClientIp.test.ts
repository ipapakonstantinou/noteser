/**
 * @jest-environment node
 *
 * getClientIp: extracts the rate-limit key from incoming request
 * headers. TRUSTED_PROXY_COUNT controls how many trailing XFF entries
 * we trust as platform-written (default 1 — Vercel's behaviour).
 *
 * Audit finding 4: prior behaviour blindly trusted the LEFTMOST
 * value, which a self-hosted deployment behind a reverse proxy could
 * have spoofed. The new logic strips trustedCount entries from the
 * RIGHT and takes the rightmost survivor.
 */

import { getClientIp } from '../utils/rateLimit'

const ORIG_ENV = process.env.TRUSTED_PROXY_COUNT

function req(headers: Record<string, string>): Request {
  return new Request('https://example.com/', { headers })
}

afterEach(() => {
  if (ORIG_ENV == null) delete process.env.TRUSTED_PROXY_COUNT
  else process.env.TRUSTED_PROXY_COUNT = ORIG_ENV
})

describe('getClientIp — XFF trust depth', () => {
  test('default (count=1): single XFF entry is NOT trusted — it could be attacker', () => {
    // With count=1 we expect XFF to have at least 2 entries (client + edge).
    // A single-entry XFF means no trusted proxy added a value above the
    // client's claim, so we refuse to trust it. Falls through to
    // x-real-ip then the unknown sentinel.
    delete process.env.TRUSTED_PROXY_COUNT
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBe('__unknown__')
  })

  test('default (count=1): two-entry XFF → strip 1, take rightmost', () => {
    // Real flow on Vercel: client appends "real-client", edge appends "vercel".
    // Strip vercel → take real-client.
    delete process.env.TRUSTED_PROXY_COUNT
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4')
  })

  test('attacker-prepended XFF is ignored when trustedCount matches reality', () => {
    // Attacker sends X-Forwarded-For: evil, real-client, edge-proxy.
    // count=1 strips edge-proxy → ['evil', 'real-client'] → rightmost = real-client.
    // The attacker's spoofed "evil" entry never gets used as the rate-limit key.
    delete process.env.TRUSTED_PROXY_COUNT
    expect(getClientIp(req({ 'x-forwarded-for': 'evil, real-client, edge' }))).toBe('real-client')
  })

  test('count=2: strip two right-hand entries', () => {
    process.env.TRUSTED_PROXY_COUNT = '2'
    expect(getClientIp(req({ 'x-forwarded-for': 'real, mid-proxy, edge-proxy' }))).toBe('real')
  })

  test('count=0: fall through to x-real-ip when XFF is the only header', () => {
    // count=0 means "no trusted XFF entries" — drop XFF entirely.
    process.env.TRUSTED_PROXY_COUNT = '0'
    expect(getClientIp(req({ 'x-forwarded-for': 'evil', 'x-real-ip': '1.2.3.4' }))).toBe('1.2.3.4')
  })

  test('count=0: XFF is fully ignored, falls back to sentinel when no other header', () => {
    process.env.TRUSTED_PROXY_COUNT = '0'
    expect(getClientIp(req({ 'x-forwarded-for': 'evil' }))).toBe('__unknown__')
  })

  test('count exceeds XFF length: trim is empty, fall through', () => {
    process.env.TRUSTED_PROXY_COUNT = '5'
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8')
  })

  test('no XFF: x-real-ip is used', () => {
    delete process.env.TRUSTED_PROXY_COUNT
    expect(getClientIp(req({ 'x-real-ip': '1.2.3.4' }))).toBe('1.2.3.4')
  })

  test('no headers: __unknown__ sentinel', () => {
    delete process.env.TRUSTED_PROXY_COUNT
    expect(getClientIp(req({}))).toBe('__unknown__')
  })

  test('whitespace in XFF entries is trimmed', () => {
    delete process.env.TRUSTED_PROXY_COUNT
    expect(getClientIp(req({ 'x-forwarded-for': '  1.2.3.4  ,  10.0.0.1  ' }))).toBe('1.2.3.4')
  })

  test('invalid TRUSTED_PROXY_COUNT falls back to default 1', () => {
    process.env.TRUSTED_PROXY_COUNT = 'banana'
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4')
  })
})
