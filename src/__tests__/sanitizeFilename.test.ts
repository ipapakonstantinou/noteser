/**
 * sanitizeFilename.test.ts
 *
 * Guards the space-preserving behavior. sanitizeFilename used to replace
 * every whitespace run with a dash ("Daily Note" -> "Daily-Note"), which
 * mangled note/folder names and titles. It now keeps single spaces, collapses
 * doubles, trims, strips illegal chars, and truncates — and stays idempotent
 * so push/pull paths round-trip without re-upload churn.
 */

import { sanitizeFilename, sanitizeTitleInput } from '../utils/sanitizeFilename'

describe('sanitizeFilename — preserves spaces', () => {
  test('preserves internal single spaces', () => {
    expect(sanitizeFilename('Daily Note')).toBe('Daily Note')
    expect(sanitizeFilename('Q1 Goals')).toBe('Q1 Goals')
    expect(sanitizeFilename('New Project')).toBe('New Project')
  })

  test('trims leading and trailing whitespace', () => {
    expect(sanitizeFilename('  Foo  ')).toBe('Foo')
  })

  test('collapses runs of whitespace to a single space', () => {
    expect(sanitizeFilename('Foo  Bar   Baz')).toBe('Foo Bar Baz')
    // illegal chars are stripped first, which can leave doubled spaces
    expect(sanitizeFilename('BG-P : Group Logic')).toBe('BG-P Group Logic')
  })

  test('strips filesystem/git-illegal characters', () => {
    expect(sanitizeFilename('Foo/Bar')).toBe('FooBar')
    expect(sanitizeFilename('Foo:Bar')).toBe('FooBar')
    expect(sanitizeFilename('a<b>c|d?e*f"g')).toBe('abcdefg')
  })

  test('preserves allowed punctuation: dash, underscore, dot, parens', () => {
    expect(sanitizeFilename('My-Note_v2 (Final).draft')).toBe('My-Note_v2 (Final).draft')
  })

  test('truncates to 100 chars', () => {
    expect(sanitizeFilename('a'.repeat(150))).toHaveLength(100)
  })

  test('is idempotent (round-trip stable)', () => {
    for (const input of ['Daily Note', 'Foo  Bar', '  Trim Me  ', 'BG-P : Group Logic']) {
      const once = sanitizeFilename(input)
      expect(sanitizeFilename(once)).toBe(once)
    }
  })

  test('matches sanitizeTitleInput on space handling', () => {
    // The live-input sanitizer always preserved spaces; the filename one now
    // agrees for the common single-space case.
    expect(sanitizeTitleInput('Daily Note')).toBe('Daily Note')
    expect(sanitizeFilename('Daily Note')).toBe('Daily Note')
  })
})
