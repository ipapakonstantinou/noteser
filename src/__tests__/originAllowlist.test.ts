/**
 * originAllowlist.test.ts
 *
 * Locks in the Origin / Referer check used by the GitHub OAuth proxy
 * routes. Same-origin always passes (which is how Vercel preview
 * deploys pass — the app calls its own `/api/*`); localhost / loopback
 * / RFC1918 LAN IPs pass for `next dev`; NEXT_PUBLIC_EXTRA_ORIGINS is
 * honored for opt-in extras. Anything else is rejected, *.vercel.app
 * included — it is a shared namespace, not ours.
 */

import { isOriginAllowed } from '../utils/originAllowlist'

// jsdom doesn't expose global Request, so we hand-roll a minimal stub
// matching only what isOriginAllowed reads: .url + .headers.get().
function req(url: string, headers: Record<string, string>): Request {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    url,
    headers: { get: (k: string) => lower.get(k.toLowerCase()) ?? null },
  } as unknown as Request
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_EXTRA_ORIGINS
})

test('same-origin passes', () => {
  const r = req('https://noteser.thetechjon.com/api/github/access-token', {
    origin: 'https://noteser.thetechjon.com',
  })
  expect(isOriginAllowed(r)).toEqual({ ok: true, origin: 'https://noteser.thetechjon.com' })
})

test('referer fallback when origin header is missing', () => {
  const r = req('https://noteser.thetechjon.com/api/github/access-token', {
    referer: 'https://noteser.thetechjon.com/some/page',
  })
  const res = isOriginAllowed(r)
  expect(res.ok).toBe(true)
})

test('localhost passes regardless of port', () => {
  const r = req('http://localhost:3001/api/github/access-token', {
    origin: 'http://localhost:3001',
  })
  expect(isOriginAllowed(r).ok).toBe(true)
  const r2 = req('http://localhost:3001/api/github/access-token', {
    origin: 'http://localhost:5000',
  })
  expect(isOriginAllowed(r2).ok).toBe(true)
})

test('RFC1918 LAN IPs pass (dev binding 0.0.0.0)', () => {
  const r = req('http://192.168.2.23:3001/api/github/access-token', {
    origin: 'http://192.168.2.23:3001',
  })
  expect(isOriginAllowed(r).ok).toBe(true)
  const r2 = req('http://10.0.0.5:3001/api/github/access-token', {
    origin: 'http://10.0.0.5:3001',
  })
  expect(isOriginAllowed(r2).ok).toBe(true)
})

test('a preview deploy calling its own API passes (same-origin)', () => {
  const r = req('https://noteser-abc.vercel.app/api/github/access-token', {
    origin: 'https://noteser-abc.vercel.app',
  })
  expect(isOriginAllowed(r).ok).toBe(true)
})

test('a stranger *.vercel.app origin is rejected', () => {
  const r = req('https://noteser.app/api/github/access-token', {
    origin: 'https://evil.vercel.app',
  })
  expect(isOriginAllowed(r).ok).toBe(false)
})

test('a cross-origin preview host needs an explicit extras entry', () => {
  const r = req('https://noteser.app/api/github/access-token', {
    origin: 'https://noteser-abc.vercel.app',
  })
  expect(isOriginAllowed(r).ok).toBe(false)
  process.env.NEXT_PUBLIC_EXTRA_ORIGINS = 'https://noteser-abc.vercel.app'
  expect(isOriginAllowed(r).ok).toBe(true)
})

test('a hostile cross-origin request is rejected', () => {
  const r = req('https://noteser.thetechjon.com/api/github/access-token', {
    origin: 'https://evil.example.com',
  })
  const res = isOriginAllowed(r)
  expect(res.ok).toBe(false)
})

test('missing Origin AND Referer headers is rejected', () => {
  const r = req('https://noteser.thetechjon.com/api/github/access-token', {})
  const res = isOriginAllowed(r)
  expect(res.ok).toBe(false)
})

test('NEXT_PUBLIC_EXTRA_ORIGINS allowlist is honored', () => {
  process.env.NEXT_PUBLIC_EXTRA_ORIGINS = 'https://example.com,https://my-noteser.org'
  const r = req('https://noteser.thetechjon.com/api/github/access-token', {
    origin: 'https://example.com',
  })
  expect(isOriginAllowed(r).ok).toBe(true)
})
