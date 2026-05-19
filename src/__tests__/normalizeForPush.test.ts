/**
 * normalizeForPush.test.ts
 *
 * Tests for the canonical wire-form normalization used before computing
 * blob SHAs. The whole point of this helper is to keep our SHAs in sync
 * with what Obsidian / git / other POSIX-y editors write to the remote,
 * so we don't end up re-uploading every note on every cycle.
 */

import { normalizeForPush, serializeNote } from '../utils/githubSync'

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
})
