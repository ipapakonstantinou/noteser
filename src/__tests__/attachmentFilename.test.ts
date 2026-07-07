/**
 * attachmentFilename.test.ts
 *
 * Pure filename-generation logic for pasted/dropped/attached images (#124):
 *   - buildAttachmentFilename expands a pattern + context into one filename.
 *   - resolveAttachmentFilename adds collision handling on top, given an
 *     `exists` check the caller supplies.
 */

import {
  buildAttachmentFilename,
  resolveAttachmentFilename,
  DEFAULT_ATTACHMENT_FILENAME_PATTERN,
  type AttachmentFilenameContext,
} from '../utils/attachmentFilename'

const ctx = (overrides: Partial<AttachmentFilenameContext> = {}): AttachmentFilenameContext => ({
  now: new Date(2026, 4, 19, 9, 56, 12),
  noteTitle: 'My Note',
  originalName: 'Pasted image 20240101.png',
  ...overrides,
})

describe('buildAttachmentFilename', () => {
  test('default pattern reproduces the legacy <timestamp>-<originalName> shape', () => {
    expect(buildAttachmentFilename(DEFAULT_ATTACHMENT_FILENAME_PATTERN, ctx(), 1))
      .toBe('20260519095612-Pasted image 20240101.png')
  })

  test('{noteTitle} substitutes the note title', () => {
    expect(buildAttachmentFilename('{noteTitle}-{counter}', ctx(), 1)).toBe('My Note-1.png')
  })

  test('{counter} substitutes the given counter value', () => {
    expect(buildAttachmentFilename('img-{counter}', ctx(), 3)).toBe('img-3.png')
  })

  test('{date:FORMAT} uses the given dateFormat.ts tokens', () => {
    expect(buildAttachmentFilename('{date:YYYY-MM-DD}', ctx(), 1)).toBe('2026-05-19.png')
  })

  test('{date} with no sub-format uses the legacy YYYYMMDDHHmmss timestamp', () => {
    expect(buildAttachmentFilename('{date}', ctx(), 1)).toBe('20260519095612.png')
  })

  test('the extension always comes from the original file, never from the pattern', () => {
    expect(buildAttachmentFilename('screenshot', ctx({ originalName: 'diagram.JPG' }), 1))
      .toBe('screenshot.JPG')
  })

  test('extensionless original names produce an extensionless filename', () => {
    expect(buildAttachmentFilename('{originalName}', ctx({ originalName: 'noext' }), 1)).toBe('noext')
  })

  test('sanitizes filesystem-unsafe characters introduced by tokens', () => {
    expect(buildAttachmentFilename('{noteTitle}', ctx({ noteTitle: 'a/b:c*d' }), 1)).toBe('a-bcd.png')
  })

  test('falls back to "image" when the expanded stem is empty', () => {
    expect(buildAttachmentFilename('***', ctx(), 1)).toBe('image.png')
  })

  test('unknown tokens pass through verbatim', () => {
    expect(buildAttachmentFilename('{unknown}-{counter}', ctx(), 1)).toBe('{unknown}-1.png')
  })
})

describe('resolveAttachmentFilename', () => {
  test('returns the base filename when nothing collides', async () => {
    const name = await resolveAttachmentFilename(DEFAULT_ATTACHMENT_FILENAME_PATTERN, ctx(), () => false)
    expect(name).toBe('20260519095612-Pasted image 20240101.png')
  })

  test('pattern without {counter}: collisions append -N before the extension', async () => {
    const existing = new Set([
      '20260519095612-Pasted image 20240101.png',
      '20260519095612-Pasted image 20240101-1.png',
    ])
    const name = await resolveAttachmentFilename(
      DEFAULT_ATTACHMENT_FILENAME_PATTERN,
      ctx(),
      (n) => existing.has(n),
    )
    expect(name).toBe('20260519095612-Pasted image 20240101-2.png')
  })

  test('pattern without {counter} and an extensionless name still resolves', async () => {
    const existing = new Set(['20260519095612-noext'])
    const name = await resolveAttachmentFilename(
      DEFAULT_ATTACHMENT_FILENAME_PATTERN,
      ctx({ originalName: 'noext' }),
      (n) => existing.has(n),
    )
    expect(name).toBe('20260519095612-noext-1')
  })

  test('pattern WITH {counter}: the token itself is bumped on collision', async () => {
    const existing = new Set(['img-1.png', 'img-2.png'])
    const name = await resolveAttachmentFilename('img-{counter}', ctx(), (n) => existing.has(n))
    expect(name).toBe('img-3.png')
  })

  test('accepts an async exists predicate', async () => {
    const existing = new Set(['img-1.png'])
    const name = await resolveAttachmentFilename(
      'img-{counter}',
      ctx(),
      async (n) => Promise.resolve(existing.has(n)),
    )
    expect(name).toBe('img-2.png')
  })
})
