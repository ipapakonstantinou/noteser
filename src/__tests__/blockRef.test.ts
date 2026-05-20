/**
 * blockRef.test.ts
 *
 * Verifies the block-ref helpers used by the "Copy block ref" command.
 */

import {
  generateBlockId,
  extractTrailingBlockId,
  appendBlockId,
  buildBlockRefLink,
} from '../utils/blockRef'

describe('generateBlockId', () => {
  test('returns a 6-char lowercase alphanumeric string', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateBlockId()
      expect(id).toMatch(/^[a-z0-9]{6}$/)
    }
  })

  test('two consecutive ids are different (extremely high probability)', () => {
    expect(generateBlockId()).not.toBe(generateBlockId())
  })
})

describe('extractTrailingBlockId', () => {
  test('returns the id (no ^) when present at end of line', () => {
    expect(extractTrailingBlockId('hello world ^abc')).toBe('abc')
    expect(extractTrailingBlockId('hello world ^abc-123')).toBe('abc-123')
  })

  test('allows trailing whitespace', () => {
    expect(extractTrailingBlockId('hello ^abc   ')).toBe('abc')
  })

  test('block-id-only line is matched', () => {
    expect(extractTrailingBlockId('^solo')).toBe('solo')
  })

  test('returns null when no trailing ^id', () => {
    expect(extractTrailingBlockId('hello')).toBeNull()
    expect(extractTrailingBlockId('')).toBeNull()
  })

  test('mid-paragraph ^foo is NOT a false positive', () => {
    expect(extractTrailingBlockId('hello ^foo bar')).toBeNull()
  })

  test('caret without an id is not matched', () => {
    expect(extractTrailingBlockId('hello ^')).toBeNull()
  })
})

describe('appendBlockId', () => {
  test('appends with a single space separator', () => {
    expect(appendBlockId('hello world', 'abc')).toBe('hello world ^abc')
  })

  test('collapses trailing whitespace before appending', () => {
    expect(appendBlockId('hello   ', 'abc')).toBe('hello ^abc')
  })

  test('empty line gets a bare ^id', () => {
    expect(appendBlockId('', 'abc')).toBe('^abc')
    expect(appendBlockId('   ', 'abc')).toBe('^abc')
  })
})

describe('buildBlockRefLink', () => {
  test('canonical [[Title#^id]] format', () => {
    expect(buildBlockRefLink('My Note', 'abc-123')).toBe('[[My Note#^abc-123]]')
  })

  test('titles with spaces and punctuation pass through verbatim', () => {
    expect(buildBlockRefLink('Project: Foo', 'x')).toBe('[[Project: Foo#^x]]')
  })
})
