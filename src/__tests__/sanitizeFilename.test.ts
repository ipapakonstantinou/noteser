/**
 * sanitizeFilename.test.ts
 *
 * Guards the space-preserving behavior AND the relaxed character rule.
 *
 * sanitizeFilename used to replace every whitespace run with a dash
 * ("Daily Note" -> "Daily-Note"); that was already fixed to preserve spaces.
 *
 * relaxed-sanitizer (the churn fix): it used to ALSO strip git-legal
 * characters via a tight letters/digits whitelist (`[^\p{L}\p{N} \-_.()]`),
 * removing `&`, apostrophes, `,`, `!`, `[`, `]`, etc. Real Obsidian vaults are
 * full of those ("R&D Work", "Jake's project", "Users & groups"), so the
 * stripped derivation drifted from the real remote path and every sync renamed
 * the user's files. It now strips ONLY what git + cross-platform filesystems
 * truly forbid: the path separators `/` `\`, the Windows-reserved set
 * `: * ? " < > |`, and control chars. Everything else is kept. It still
 * collapses whitespace, trims, strips leading/trailing dots, truncates, and
 * stays idempotent so push/pull paths round-trip without re-upload churn.
 */

import { sanitizeFilename, sanitizeTitleInput, INVALID_FILENAME_CHARS } from '../utils/sanitizeFilename'

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

  test('truncates to 100 chars', () => {
    expect(sanitizeFilename('a'.repeat(150))).toHaveLength(100)
  })
})

describe('sanitizeFilename — relaxed character rule', () => {
  test('KEEPS git-legal characters the old whitelist wrongly stripped', () => {
    // These are the real-vault names that drove the churn bug.
    expect(sanitizeFilename('R&D Work')).toBe('R&D Work')
    expect(sanitizeFilename('R&D Personal')).toBe('R&D Personal')
    expect(sanitizeFilename("Jake's project")).toBe("Jake's project")
    expect(sanitizeFilename('NEB Jake’s project')).toBe('NEB Jake’s project') // curly apostrophe
    expect(sanitizeFilename('Users & groups')).toBe('Users & groups')
  })

  test('KEEPS the broader punctuation set', () => {
    expect(sanitizeFilename('Day, one! [draft]+v2 @home #tag ~tmp;')).toBe(
      'Day, one! [draft]+v2 @home #tag ~tmp;',
    )
    expect(sanitizeFilename('a=b & c@d')).toBe('a=b & c@d')
  })

  test('preserves allowed punctuation: dash, underscore, dot, parens', () => {
    expect(sanitizeFilename('My-Note_v2 (Final).draft')).toBe('My-Note_v2 (Final).draft')
  })

  test('strips ONLY the truly-forbidden chars: / \\ : * ? " < > | + control', () => {
    expect(sanitizeFilename('Foo/Bar')).toBe('FooBar')
    expect(sanitizeFilename('Foo\\Bar')).toBe('FooBar')
    expect(sanitizeFilename('Foo:Bar')).toBe('FooBar')
    expect(sanitizeFilename('a<b>c|d?e*f"g')).toBe('abcdefg')
    // A control char (U+0001) is stripped by INVALID_FILENAME_CHARS BEFORE the
    // whitespace collapse, so it leaves nothing behind (segments join directly).
    expect(sanitizeFilename(`Foo${String.fromCharCode(1)}Bar`)).toBe('FooBar')
    // A tab (U+0009) is a control char too, so it is stripped the same way.
    expect(sanitizeFilename(`Foo${String.fromCharCode(9)}Bar`)).toBe('FooBar')
  })

  test('PRESERVES dots, including leading dots for dotfile folders', () => {
    // Obsidian dotfile folders MUST survive verbatim — stripping the leading
    // dot would mangle them and re-introduce path-drift churn.
    expect(sanitizeFilename('.obsidian')).toBe('.obsidian')
    expect(sanitizeFilename('.noteser')).toBe('.noteser')
    expect(sanitizeFilename('.trash')).toBe('.trash')
    expect(sanitizeFilename('.gitignore')).toBe('.gitignore')
    expect(sanitizeFilename('v1.2.3 notes')).toBe('v1.2.3 notes')
  })

  test('is idempotent (round-trip stable) including the kept characters', () => {
    for (const input of [
      'Daily Note',
      'Foo  Bar',
      '  Trim Me  ',
      'BG-P : Group Logic',
      'R&D Work',
      "Jake's project",
      'Users & groups',
      'Day, one! [draft]+v2 @home #tag ~tmp;',
    ]) {
      const once = sanitizeFilename(input)
      expect(sanitizeFilename(once)).toBe(once)
    }
  })

  test('INVALID_FILENAME_CHARS matches forbidden chars but NOT kept ones', () => {
    const reTest = (ch: string) => new RegExp(INVALID_FILENAME_CHARS.source, 'u').test(ch)
    // Forbidden — must match.
    for (const ch of ['/', '\\', ':', '*', '?', '"', '<', '>', '|', String.fromCharCode(1)]) {
      expect(reTest(ch)).toBe(true)
    }
    // Kept — must NOT match (note: space is NOT in the class; it is handled by
    // the whitespace-collapse step, not by stripping).
    for (const ch of ['&', "'", '’', ',', '!', ';', '+', '=', '@', '#', '[', ']', '~', '(', ')', '-', '_', '.', ' ']) {
      expect(reTest(ch)).toBe(false)
    }
  })
})

describe('sanitizeTitleInput — live typing stays in sync with the relaxed rule', () => {
  test('preserves spaces and the kept characters while typing', () => {
    expect(sanitizeTitleInput('Daily Note')).toBe('Daily Note')
    expect(sanitizeTitleInput('R&D Work')).toBe('R&D Work')
    expect(sanitizeTitleInput("Jake's project")).toBe("Jake's project")
    expect(sanitizeTitleInput('Users & groups')).toBe('Users & groups')
  })

  test('still drops the truly-forbidden chars while typing', () => {
    expect(sanitizeTitleInput('Foo/Bar:Baz')).toBe('FooBarBaz')
    expect(sanitizeTitleInput('a<b>c|d')).toBe('abcd')
  })

  test('agrees with sanitizeFilename on the kept-character set', () => {
    for (const s of ['R&D Work', "Jake's project", 'Users & groups', 'Daily Note']) {
      // sanitizeTitleInput does not collapse/trim, but for these single-spaced
      // inputs the kept-character decision must match.
      expect(sanitizeTitleInput(s)).toBe(sanitizeFilename(s))
    }
  })
})
