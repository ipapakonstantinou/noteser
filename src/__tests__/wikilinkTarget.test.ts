/**
 * wikilinkTarget.test.ts
 *
 * Verifies the fragment parser + line resolver used by e4t8 (block +
 * heading link navigation).
 */

import {
  parseWikilinkTarget,
  findFragmentLine,
  encodeWikilinkHref,
  decodeWikilinkHref,
} from '../utils/wikilinkTarget'

describe('parseWikilinkTarget', () => {
  test('plain title without fragment', () => {
    expect(parseWikilinkTarget('My note')).toEqual({ title: 'My note', fragment: null })
  })

  test('title with heading fragment', () => {
    expect(parseWikilinkTarget('My note#Section'))
      .toEqual({ title: 'My note', fragment: 'Section' })
  })

  test('title with block fragment keeps the ^', () => {
    expect(parseWikilinkTarget('My note#^abc-123'))
      .toEqual({ title: 'My note', fragment: '^abc-123' })
  })

  test('trims whitespace from both parts', () => {
    expect(parseWikilinkTarget('  hello  #  world  '))
      .toEqual({ title: 'hello', fragment: 'world' })
  })

  test('empty fragment becomes null', () => {
    expect(parseWikilinkTarget('hello#')).toEqual({ title: 'hello', fragment: null })
  })
})

describe('findFragmentLine — heading', () => {
  const doc = [
    'intro',
    '# Top',
    '',
    'before sub',
    '## Sub',
    'in sub',
    '### Deep',
  ].join('\n')

  test('finds an h1', () => {
    expect(findFragmentLine(doc, 'Top')).toBe(1)
  })

  test('finds an h2', () => {
    expect(findFragmentLine(doc, 'Sub')).toBe(4)
  })

  test('finds an h3', () => {
    expect(findFragmentLine(doc, 'Deep')).toBe(6)
  })

  test('is case-insensitive', () => {
    expect(findFragmentLine(doc, 'top')).toBe(1)
    expect(findFragmentLine(doc, 'SUB')).toBe(4)
  })

  test('returns null when no heading matches', () => {
    expect(findFragmentLine(doc, 'Missing')).toBeNull()
  })
})

describe('findFragmentLine — block', () => {
  const doc = [
    'line zero',
    'line one ^foo',
    'line two',
    'line three trailing ^bar-2',
    '^orphan',
  ].join('\n')

  test('finds a block id mid-document', () => {
    expect(findFragmentLine(doc, '^foo')).toBe(1)
  })

  test('matches dashes + digits in block ids', () => {
    expect(findFragmentLine(doc, '^bar-2')).toBe(3)
  })

  test('block id alone on a line still matches', () => {
    // Per spec: "preceded by whitespace OR start of line".
    expect(findFragmentLine(doc, '^orphan')).toBe(4)
  })

  test('returns null for an unknown block id', () => {
    expect(findFragmentLine(doc, '^nope')).toBeNull()
  })

  test('block id is case-insensitive', () => {
    expect(findFragmentLine(doc, '^FOO')).toBe(1)
  })
})

describe('encode + decode wikilink href round-trip', () => {
  test('plain title', () => {
    const href = encodeWikilinkHref('Hello world', null)
    expect(decodeWikilinkHref(href)).toEqual({ title: 'Hello world', fragment: null })
  })

  test('title + heading fragment', () => {
    const href = encodeWikilinkHref('My note', 'Section A')
    expect(decodeWikilinkHref(href)).toEqual({ title: 'My note', fragment: 'Section A' })
  })

  test('title + block fragment', () => {
    const href = encodeWikilinkHref('My note', '^abc')
    expect(decodeWikilinkHref(href)).toEqual({ title: 'My note', fragment: '^abc' })
  })

  test('decode returns null for non-wikilink hrefs', () => {
    expect(decodeWikilinkHref('https://example.com')).toBeNull()
  })

  test('decode handles a bare href without a query string (back-compat)', () => {
    expect(decodeWikilinkHref('wikilink://Some%20note'))
      .toEqual({ title: 'Some note', fragment: null })
  })
})
