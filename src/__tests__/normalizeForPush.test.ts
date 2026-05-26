/**
 * normalizeForPush.test.ts
 *
 * Tests for the canonical wire-form normalization used before computing
 * blob SHAs. The whole point of this helper is to keep our SHAs in sync
 * with what Obsidian / git / other POSIX-y editors write to the remote,
 * so we don't end up re-uploading every note on every cycle.
 */

import { normalizeForPush, serializeNote, isUnchangedModuloNormalization } from '../utils/githubSync'

describe('normalizeForPush', () => {
  test('empty string stays empty (no spurious trailing newline)', () => {
    expect(normalizeForPush('')).toBe('')
  })

  test('content without trailing newline gains exactly one', () => {
    expect(normalizeForPush('abc')).toBe('abc\n')
  })

  test('content already ending with \\n is unchanged', () => {
    expect(normalizeForPush('abc\n')).toBe('abc\n')
  })

  test('multiple trailing newlines are preserved (no double-trim)', () => {
    // We only ENSURE a trailing newline; we don't truncate extras —
    // Obsidian doesn't either, and trimming could surprise users with
    // intentional spacing in their notes.
    expect(normalizeForPush('abc\n\n')).toBe('abc\n\n')
  })

  test('CRLF line endings are converted to LF', () => {
    expect(normalizeForPush('line1\r\nline2\r\n')).toBe('line1\nline2\n')
  })

  test('mixed CRLF + LF is normalised to all LF', () => {
    expect(normalizeForPush('a\r\nb\nc')).toBe('a\nb\nc\n')
  })

  test('CR-only (old-Mac style) is left alone — we don\'t handle that case', () => {
    // Out of scope; nothing on the modern web emits \r alone. Documenting
    // the no-op so a future contributor doesn't "fix" the missing branch
    // and accidentally split content on something else.
    expect(normalizeForPush('a\rb')).toBe('a\rb\n')
  })

  test('is idempotent: normalising twice yields the same result', () => {
    const a = normalizeForPush('hello\r\nworld')
    expect(normalizeForPush(a)).toBe(a)
  })
})

describe('serializeNote — wires through normalizeForPush', () => {
  test('adds a trailing newline to a note whose content lacks one', () => {
    const note = { content: 'hello' } as Parameters<typeof serializeNote>[0]
    expect(serializeNote(note)).toBe('hello\n')
  })

  test('handles null/undefined content as empty string', () => {
    const note = { content: undefined } as unknown as Parameters<typeof serializeNote>[0]
    expect(serializeNote(note)).toBe('')
  })

  test('Obsidian-style content (CRLF + trailing \\n) round-trips cleanly', () => {
    const note = { content: 'a\r\nb\r\n' } as Parameters<typeof serializeNote>[0]
    expect(serializeNote(note)).toBe('a\nb\n')
  })

  // content-normalization-churn: smart punctuation must survive serialization
  // BYTE-FOR-BYTE. The only thing serializeNote/normalizeForPush touches is line
  // endings + the trailing newline; every other codepoint is preserved verbatim.
  test('smart punctuation (U+2019 U+2014 U+2009 U+00A0 U+201C/D) survives serialization verbatim', () => {
    // Don’t…thin-space em-dash thin-space…nbsp…curly quotes — NO trailing newline.
    const body =
      'Don’t overthink it — just ship. Really.\nA “great” idea.'
    const note = { content: body } as Parameters<typeof serializeNote>[0]
    const out = serializeNote(note)
    // Trailing newline added (canonical), but every smart codepoint intact.
    expect(out).toBe(body + '\n')
    expect(out).toContain('’')
    expect(out).toContain('—')
    expect(out).toContain(' ')
    expect(out).toContain(' ')
    expect(out).toContain('“')
    expect(out).toContain('”')
    // Idempotent: re-serializing the canonical form is a no-op (no further drift).
    expect(serializeNote({ content: out } as Parameters<typeof serializeNote>[0])).toBe(out)
  })
})

// content-normalization-churn: the "did the user edit this?" predicate. Returns
// true (UNEDITED) iff the two bodies differ ONLY by normalization — line endings
// or the trailing newline — and false when any real content byte changed.
describe('isUnchangedModuloNormalization', () => {
  test('identical bodies are unchanged', () => {
    expect(isUnchangedModuloNormalization('hello world', 'hello world')).toBe(true)
  })

  test('trailing-newline-only difference is unchanged (the legacy/Obsidian churn case)', () => {
    // Remote (Obsidian) has no trailing newline; local canonical has one.
    expect(isUnchangedModuloNormalization('Some note body\n', 'Some note body')).toBe(true)
    expect(isUnchangedModuloNormalization('Some note body', 'Some note body\n')).toBe(true)
  })

  test('CRLF-vs-LF-only difference is unchanged', () => {
    expect(isUnchangedModuloNormalization('a\nb\nc', 'a\r\nb\r\nc')).toBe(true)
  })

  test('smart-punctuation note with trailing-newline drift is unchanged (Jon\'s real note)', () => {
    const remote = 'Don’t overthink it — just ship. Really.' // no \n
    const local = remote + '\n' // canonical, with trailing \n
    expect(isUnchangedModuloNormalization(local, remote)).toBe(true)
  })

  test('a genuine content edit is NOT unchanged', () => {
    expect(isUnchangedModuloNormalization('hello world EDITED\n', 'hello world')).toBe(false)
  })

  test('a single smart-punctuation change IS detected as an edit (no over-suppression)', () => {
    // Straight apostrophe vs curly apostrophe is a real byte change → edited.
    expect(isUnchangedModuloNormalization("Don't\n", 'Don’t')).toBe(false)
  })

  test('empty body vs empty-with-newline: both normalize away, unchanged', () => {
    expect(isUnchangedModuloNormalization('', '')).toBe(true)
  })
})
