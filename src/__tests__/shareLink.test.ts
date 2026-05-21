/**
 * shareLink.test.ts
 *
 * Round-trip tests for the share-link encoder + decoder used by the
 * /share route. No DOM dependencies in the helpers, just btoa/atob +
 * TextEncoder.
 */

import {
  encodeShareLink,
  decodeShareFragment,
  estimateShareLinkSize,
  isShareLinkExpired,
  isShareLinkBurned,
  markShareLinkBurned,
  shareLinkBurnKey,
} from '../utils/shareLink'

describe('encodeShareLink / decodeShareFragment', () => {
  test('round-trips ASCII title + content', () => {
    const url = encodeShareLink('Hello', 'world', 'https://example.com')
    const frag = url.split('#')[1]
    const decoded = decodeShareFragment(frag)
    expect(decoded).not.toBeNull()
    expect(decoded!.title).toBe('Hello')
    expect(decoded!.content).toBe('world')
    // New default is v2 — v1 stays decodable for backward compat.
    expect(decoded!.v).toBe(2)
  })

  test('round-trips UTF-8 content (emoji + non-Latin)', () => {
    const content = '🚀 héllo • 日本語 • ✅ done'
    const url = encodeShareLink('UTF-8 test', content, 'https://x.com')
    const decoded = decodeShareFragment(url.split('#')[1])
    expect(decoded!.content).toBe(content)
  })

  test('round-trips markdown with backticks + newlines', () => {
    const content = '# Heading\n\n`inline code` + **bold**\n\n```js\nfoo()\n```'
    const decoded = decodeShareFragment(
      encodeShareLink('md', content, 'http://x').split('#')[1],
    )
    expect(decoded!.content).toBe(content)
  })

  test('decodeShareFragment accepts a fragment with leading #', () => {
    const url = encodeShareLink('T', 'C', 'http://x')
    const frag = url.split('#')[1]
    expect(decodeShareFragment(`#${frag}`)).not.toBeNull()
  })

  test('decodeShareFragment returns null for an empty fragment', () => {
    expect(decodeShareFragment('')).toBeNull()
  })

  test('decodeShareFragment returns null for malformed input', () => {
    expect(decodeShareFragment('this-is-not-base64')).toBeNull()
    expect(decodeShareFragment('eyJqdW5rIjp0cnVlfQ')).toBeNull() // valid b64+JSON but wrong shape
  })

  test('decodeShareFragment accepts both v1 and v2 payloads', () => {
    // v1 — legacy share URLs in the wild should still decode.
    const v1 = Buffer.from(JSON.stringify({ v: 1, title: 'old', content: 'note', ts: 0 })).toString('base64')
    const decodedV1 = decodeShareFragment(v1.replace(/=+$/, ''))
    expect(decodedV1).not.toBeNull()
    expect(decodedV1!.v).toBe(1)
    // v2 — the new default.
    const v2 = Buffer.from(JSON.stringify({ v: 2, title: 'new', content: 'note', ts: 0 })).toString('base64')
    expect(decodeShareFragment(v2.replace(/=+$/, ''))).not.toBeNull()
  })

  test('decodeShareFragment rejects an unknown version field', () => {
    const v9 = Buffer.from(JSON.stringify({ v: 9, title: 'x', content: 'y', ts: 0 })).toString('base64')
    expect(decodeShareFragment(v9.replace(/=+$/, ''))).toBeNull()
  })

  test('uses URL-safe base64 (no +, /, =)', () => {
    // Force chars that would normally produce padding/special chars in
    // standard base64.
    const url = encodeShareLink('the quick brown fox jumps over the lazy dog!?', '?ä', 'http://x')
    const frag = url.split('#')[1]
    expect(frag).not.toMatch(/[+/=]/)
  })

  test('encodeShareLink falls back to no origin when window absent', () => {
    // Pass empty origin → URL still has a #fragment.
    const url = encodeShareLink('a', 'b', '')
    expect(url.startsWith('/share#')).toBe(true)
  })
})

describe('estimateShareLinkSize', () => {
  test('grows roughly linearly with content length', () => {
    const small = estimateShareLinkSize('x', 'a'.repeat(100))
    const big = estimateShareLinkSize('x', 'a'.repeat(1000))
    expect(big).toBeGreaterThan(small * 5)   // ~10x content → at least 5x estimate
  })

  test('handles empty content without throwing', () => {
    expect(estimateShareLinkSize('', '')).toBeGreaterThan(0)
  })
})

// ── shr2: expiry ─────────────────────────────────────────────────────────

describe('expiry', () => {
  test('encodeShareLink stamps expiresAt when expiryDays > 0', () => {
    const before = Date.now()
    const url = encodeShareLink('t', 'c', { expiryDays: 7 }, 'http://x')
    const decoded = decodeShareFragment(url.split('#')[1])!
    expect(decoded.expiresAt).toBeDefined()
    // 7 days = 604_800_000 ms. Allow a 1s test-runtime fudge.
    const delta = decoded.expiresAt! - before
    expect(delta).toBeGreaterThan(7 * 86_400_000 - 1000)
    expect(delta).toBeLessThan(7 * 86_400_000 + 1000)
  })

  test('encodeShareLink omits expiresAt when expiryDays is 0 / undefined', () => {
    const noOpts = decodeShareFragment(encodeShareLink('t', 'c', undefined, 'http://x').split('#')[1])!
    const zeroDays = decodeShareFragment(encodeShareLink('t', 'c', { expiryDays: 0 }, 'http://x').split('#')[1])!
    expect(noOpts.expiresAt).toBeUndefined()
    expect(zeroDays.expiresAt).toBeUndefined()
  })

  test('isShareLinkExpired returns true past expiresAt and false before', () => {
    const url = encodeShareLink('t', 'c', { expiryDays: 1 }, 'http://x')
    const decoded = decodeShareFragment(url.split('#')[1])!
    expect(isShareLinkExpired(decoded, decoded.expiresAt! - 1)).toBe(false)
    expect(isShareLinkExpired(decoded, decoded.expiresAt! + 1)).toBe(true)
  })

  test('payloads without expiresAt never expire', () => {
    const url = encodeShareLink('t', 'c', undefined, 'http://x')
    const decoded = decodeShareFragment(url.split('#')[1])!
    expect(isShareLinkExpired(decoded, Date.now() + 100 * 86_400_000)).toBe(false)
  })
})

// ── shr2: burn-after-read ────────────────────────────────────────────────

describe('burn-after-read', () => {
  beforeEach(() => { window.localStorage.clear() })

  test('encodeShareLink stamps the burn flag when opts.burn is true', () => {
    const url = encodeShareLink('t', 'c', { burn: true }, 'http://x')
    const decoded = decodeShareFragment(url.split('#')[1])!
    expect(decoded.burn).toBe(true)
  })

  test('shareLinkBurnKey is deterministic per fragment', async () => {
    const frag = encodeShareLink('t', 'c', undefined, 'http://x').split('#')[1]
    expect(await shareLinkBurnKey(frag)).toBe(await shareLinkBurnKey(frag))
    // Different fragment → different key.
    const other = encodeShareLink('t', 'other', undefined, 'http://x').split('#')[1]
    expect(await shareLinkBurnKey(frag)).not.toBe(await shareLinkBurnKey(other))
  })

  test('shareLinkBurnKey resists collisions across many distinct fragments', async () => {
    // SHA-256 truncated to 128 bits makes accidental collisions
    // astronomically unlikely. The old FNV-1a 32-bit was vulnerable
    // to ~1-in-4-billion pairwise collisions; this is a smoke test
    // that distinct inputs reliably yield distinct keys.
    const keys = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const frag = encodeShareLink(`t${i}`, `c${i}`, undefined, 'http://x').split('#')[1]
      keys.add(await shareLinkBurnKey(frag))
    }
    expect(keys.size).toBe(500)
  })

  test('shareLinkBurnKey produces a stable, URL-safe localStorage key', async () => {
    const key = await shareLinkBurnKey('hello-fragment')
    expect(key.startsWith('noteser-share-burned-')).toBe(true)
    // The suffix is base64url (no +, /, =), short enough to fit in
    // any localStorage budget.
    const suffix = key.slice('noteser-share-burned-'.length)
    expect(suffix).not.toMatch(/[+/=]/)
    expect(suffix.length).toBeGreaterThan(0)
    expect(suffix.length).toBeLessThan(32)
  })

  test('isShareLinkBurned is false until markShareLinkBurned, then true', async () => {
    const frag = 'abc123'
    expect(await isShareLinkBurned(frag)).toBe(false)
    await markShareLinkBurned(frag)
    expect(await isShareLinkBurned(frag)).toBe(true)
  })
})
