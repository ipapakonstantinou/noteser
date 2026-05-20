/**
 * wikilinkSafety.test.ts
 *
 * Confirms that hostile wikilink content can't escape the encoded
 * `wikilink://...` URL form. Even if an attacker plants a note titled
 * `javascript:alert(1)`, the rendered link must NOT become a real
 * `javascript:` URL.
 */

import { renderWikilinks } from '../utils/wikilinks'

describe('renderWikilinks — XSS safety', () => {
  test('title with javascript: scheme is encoded into the wikilink href', () => {
    const md = renderWikilinks('[[javascript:alert(1)]]')
    // The href is a wikilink://-prefixed URL containing the encoded title.
    expect(md).toMatch(/\(wikilink:\/\/javascript%3Aalert/)
    // Crucially, the literal string "javascript:" must NOT appear as a
    // raw URL scheme. It only appears inside the encoded path or display
    // text — never as the leading scheme of an anchor href.
    expect(md).not.toMatch(/\]\(javascript:/)
  })

  test('payload that doesn\'t form a valid [[...]] passes through unchanged', () => {
    // `[[bad](javascript:alert(1))]]` contains a `]` mid-title, which the
    // wikilink regex (no-`]` lazy match) refuses to swallow. The string
    // passes through verbatim — ReactMarkdown's defaultUrlTransform
    // is then responsible for blocking the `javascript:` href in the
    // resulting `[bad](javascript:...)` markdown link.
    const input = '[[bad](javascript:alert(1))]]'
    expect(renderWikilinks(input)).toBe(input)
  })

  test('display text with brackets is stripped (no markdown injection)', () => {
    const md = renderWikilinks('[[real|displ[ay]text]]')
    // The display part has `[` and `]` removed before being placed into
    // the link text — otherwise it could break out and create new
    // markdown structures.
    expect(md).not.toMatch(/\[displ\[ay\]text/)
  })

  test('every emitted href starts with wikilink://', () => {
    const md = renderWikilinks('[[Foo]]\n[[Bar#Heading]]\n[[Baz#^block-id]]')
    const hrefs = [...md.matchAll(/\(([^)]+)\)/g)].map(m => m[1])
    expect(hrefs.length).toBe(3)
    for (const h of hrefs) {
      expect(h.startsWith('wikilink://')).toBe(true)
    }
  })

  test('non-wikilink markdown links pass through untouched', () => {
    // renderWikilinks should only transform [[wikilinks]], not regular
    // [text](url) syntax. A javascript: link in a regular markdown link
    // is ReactMarkdown's responsibility to sanitize (it does by default).
    const md = renderWikilinks('[click](https://example.com)')
    expect(md).toBe('[click](https://example.com)')
  })
})
