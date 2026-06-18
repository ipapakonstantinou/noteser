/**
 * pasteLink.test.ts
 *
 * Unit tests for src/utils/pasteLink.ts — pure string helpers behind the
 * paste-URL-as-titled-link feature. No mocks needed.
 */

import {
  isBareUrl,
  sanitizeLinkTitle,
  markdownLink,
  anchorFromHtml,
  extractHtmlTitle,
  FETCHING_TITLE_PLACEHOLDER,
} from '../utils/pasteLink'

// ── isBareUrl ────────────────────────────────────────────────────────────────

describe('isBareUrl', () => {
  test('plain https URL', () => {
    expect(isBareUrl('https://consolut.atlassian.net/browse/IIACON-261')).toBe(true)
  })

  test('http URL with query + fragment', () => {
    expect(isBareUrl('http://example.com/a?b=c#d')).toBe(true)
  })

  test('surrounding whitespace is tolerated', () => {
    expect(isBareUrl('  https://example.com \n')).toBe(true)
  })

  test('URL embedded in a sentence is NOT bare', () => {
    expect(isBareUrl('see https://example.com for details')).toBe(false)
  })

  test('multi-line clipboard is NOT bare', () => {
    expect(isBareUrl('https://example.com\nhttps://example.org')).toBe(false)
  })

  test('non-http schemes are rejected', () => {
    expect(isBareUrl('ftp://example.com')).toBe(false)
    expect(isBareUrl('javascript:alert(1)')).toBe(false)
    expect(isBareUrl('obsidian://open?vault=x')).toBe(false)
  })

  test('plain words and empty input are rejected', () => {
    expect(isBareUrl('hello')).toBe(false)
    expect(isBareUrl('')).toBe(false)
  })
})

// ── sanitizeLinkTitle / markdownLink ─────────────────────────────────────────

describe('sanitizeLinkTitle', () => {
  test('collapses internal whitespace and newlines', () => {
    expect(sanitizeLinkTitle('  Page \n\t Title  ')).toBe('Page Title')
  })

  test('escapes square brackets so the link does not terminate early', () => {
    expect(sanitizeLinkTitle('[IIACON-261] Field status group recognition')).toBe(
      '\\[IIACON-261\\] Field status group recognition',
    )
  })

  test('escapes a literal backslash so it cannot pair with bracket escapes', () => {
    expect(sanitizeLinkTitle('a\\]b')).toBe('a\\\\\\]b')
  })

  test('caps absurdly long titles with an ellipsis', () => {
    const long = 'x'.repeat(500)
    const out = sanitizeLinkTitle(long)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('markdownLink', () => {
  test('builds [title](url)', () => {
    expect(markdownLink('Example', 'https://example.com')).toBe('[Example](https://example.com)')
  })

  test('placeholder constant round-trips through markdownLink', () => {
    expect(markdownLink(FETCHING_TITLE_PLACEHOLDER, 'https://x.com')).toBe(
      `[${FETCHING_TITLE_PLACEHOLDER}](https://x.com)`,
    )
  })
})

// ── anchorFromHtml ───────────────────────────────────────────────────────────

describe('anchorFromHtml', () => {
  test('single anchor with text', () => {
    expect(anchorFromHtml('<a href="https://example.com">Example Site</a>')).toEqual({
      href: 'https://example.com',
      text: 'Example Site',
    })
  })

  test('clipboard wrapper markup around the anchor is fine', () => {
    const html = '<meta charset="utf-8"><span><a href="https://x.com" rel="noopener">Hello <b>World</b></a></span>'
    expect(anchorFromHtml(html)).toEqual({ href: 'https://x.com', text: 'Hello World' })
  })

  test('entities in anchor text are decoded', () => {
    expect(anchorFromHtml('<a href="https://x.com">A &amp; B&nbsp;&mdash;&nbsp;C</a>')?.text).toBe('A & B — C')
  })

  test('multiple anchors → null (ambiguous)', () => {
    expect(anchorFromHtml('<a href="https://a.com">a</a><a href="https://b.com">b</a>')).toBeNull()
  })

  test('anchor with no text (image link) → null', () => {
    expect(anchorFromHtml('<a href="https://a.com"><img src="x.png"></a>')).toBeNull()
  })

  test('no anchor at all → null', () => {
    expect(anchorFromHtml('<p>plain</p>')).toBeNull()
    expect(anchorFromHtml('')).toBeNull()
  })
})

// ── extractHtmlTitle ─────────────────────────────────────────────────────────

describe('extractHtmlTitle', () => {
  test('prefers og:title over <title>', () => {
    const html =
      '<head><title>Boring fallback</title><meta property="og:title" content="The Real Title"></head>'
    expect(extractHtmlTitle(html)).toBe('The Real Title')
  })

  test('og:title with attributes in reverse order', () => {
    expect(extractHtmlTitle('<meta content="Reversed" property="og:title">')).toBe('Reversed')
  })

  test('falls back to <title> and decodes entities + collapses whitespace', () => {
    const html = '<title>\n  [IIACON-261] Field status group recognition &mdash; Jira\n</title>'
    expect(extractHtmlTitle(html)).toBe('[IIACON-261] Field status group recognition — Jira')
  })

  test('<title> with attributes still matches', () => {
    expect(extractHtmlTitle('<title data-rh="true">Attr Title</title>')).toBe('Attr Title')
  })

  test('empty og:title is skipped in favor of <title>', () => {
    const html = '<meta property="og:title" content=""><title>Fallback</title>'
    expect(extractHtmlTitle(html)).toBe('Fallback')
  })

  test('no usable title → null', () => {
    expect(extractHtmlTitle('<body>nothing here</body>')).toBeNull()
    expect(extractHtmlTitle('<title>   </title>')).toBeNull()
  })

  test('nested inline tags in title text are stripped, no markup survives', () => {
    expect(extractHtmlTitle('<title>Hello <b>brave</b> <i>World</i></title>')).toBe('Hello brave World')
  })
})
