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
} from '../utils/shareLink'

describe('encodeShareLink / decodeShareFragment', () => {
  test('round-trips ASCII title + content', () => {
    const url = encodeShareLink('Hello', 'world', 'https://example.com')
    const frag = url.split('#')[1]
    const decoded = decodeShareFragment(frag)
    expect(decoded).not.toBeNull()
    expect(decoded!.title).toBe('Hello')
    expect(decoded!.content).toBe('world')
    expect(decoded!.v).toBe(1)
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

  test('decodeShareFragment rejects an unknown version field', () => {
    // Build a payload manually with v: 2.
    const b64 = Buffer.from(JSON.stringify({ v: 2, title: 'x', content: 'y', ts: 0 })).toString('base64')
    expect(decodeShareFragment(b64.replace(/=+$/, ''))).toBeNull()
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
