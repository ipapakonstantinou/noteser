/**
 * attachments.test.ts
 *
 * Covers the IDB-backed attachment store used by image drag-and-drop. We mock
 * idb-keyval with an in-memory Map so save/get/del round-trip in isolation,
 * and we stub URL.createObjectURL / revokeObjectURL since jsdom doesn't
 * implement them.
 */

// ── idb-keyval mock ───────────────────────────────────────────────────────────
const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((key: string) => Promise.resolve(idb.get(key))),
  set: jest.fn((key: string, value: unknown) => { idb.set(key, value); return Promise.resolve() }),
  del: jest.fn((key: string) => { idb.delete(key); return Promise.resolve() }),
}))

import {
  saveAttachment,
  getAttachmentBlob,
  getAttachmentUrl,
  deleteAttachment,
  sanitizeAttachmentName,
  isAttachmentPath,
  ATTACHMENT_DIR,
  _clearAttachmentUrlCache,
} from '../utils/attachments'

// ── URL.createObjectURL / revokeObjectURL stubs ───────────────────────────────
let nextUrlId = 1
const createSpy = jest.fn(() => `blob:test/${nextUrlId++}`)
const revokeSpy = jest.fn()
beforeAll(() => {
  // jsdom doesn't implement these — install once for the whole suite.
  Object.defineProperty(URL, 'createObjectURL', { value: createSpy, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeSpy, writable: true })
})

beforeEach(() => {
  idb.clear()
  _clearAttachmentUrlCache()
  createSpy.mockClear()
  revokeSpy.mockClear()
})

// ── sanitizeAttachmentName ────────────────────────────────────────────────────

describe('sanitizeAttachmentName', () => {
  test('strips directory components', () => {
    expect(sanitizeAttachmentName('/foo/bar/baz.png')).toBe('baz.png')
    expect(sanitizeAttachmentName('C:\\Users\\me\\pic.jpg')).toBe('pic.jpg')
  })

  test('preserves spaces, dots, dashes, underscores', () => {
    expect(sanitizeAttachmentName('Pasted image 20260519.png')).toBe('Pasted image 20260519.png')
    expect(sanitizeAttachmentName('my-photo_v2.jpg')).toBe('my-photo_v2.jpg')
  })

  test('strips filesystem-unsafe chars', () => {
    expect(sanitizeAttachmentName('a<b>c:d"e|f?g*h.png')).toBe('abcdefgh.png')
  })

  test('falls back to "image" when the result is empty', () => {
    expect(sanitizeAttachmentName('***')).toBe('image')
    expect(sanitizeAttachmentName('')).toBe('image')
  })
})

// ── isAttachmentPath ──────────────────────────────────────────────────────────

describe('isAttachmentPath', () => {
  test('matches paths under the attachments dir', () => {
    expect(isAttachmentPath('attachments/foo.png')).toBe(true)
    expect(isAttachmentPath(`${ATTACHMENT_DIR}/sub/foo.png`)).toBe(true)
  })

  test('rejects external URLs and unrelated paths', () => {
    expect(isAttachmentPath('https://example.com/foo.png')).toBe(false)
    expect(isAttachmentPath('data:image/png;base64,xyz')).toBe(false)
    expect(isAttachmentPath('other/foo.png')).toBe(false)
  })
})

// ── saveAttachment ────────────────────────────────────────────────────────────

describe('saveAttachment', () => {
  test('writes under attachments/<ts>-<name> and round-trips via getAttachmentBlob', async () => {
    const blob = new Blob(['hello'], { type: 'image/png' })
    const path = await saveAttachment(blob, 'hello.png', new Date(2026, 4, 19, 9, 56, 12))
    expect(path).toBe('attachments/20260519095612-hello.png')

    const fetched = await getAttachmentBlob(path)
    expect(fetched).toBe(blob)
  })

  test('appends a counter on sub-second collisions', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const now = new Date(2026, 4, 19, 9, 56, 12)
    const p1 = await saveAttachment(blob, 'pic.png', now)
    const p2 = await saveAttachment(blob, 'pic.png', now)
    const p3 = await saveAttachment(blob, 'pic.png', now)
    expect(p1).toBe('attachments/20260519095612-pic.png')
    expect(p2).toBe('attachments/20260519095612-pic-1.png')
    expect(p3).toBe('attachments/20260519095612-pic-2.png')
  })

  test('handles extensionless filenames', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const now = new Date(2026, 4, 19, 9, 56, 12)
    const p1 = await saveAttachment(blob, 'noext', now)
    const p2 = await saveAttachment(blob, 'noext', now)
    expect(p1).toBe('attachments/20260519095612-noext')
    expect(p2).toBe('attachments/20260519095612-noext-1')
  })
})

// ── getAttachmentUrl ──────────────────────────────────────────────────────────

describe('getAttachmentUrl', () => {
  test('returns null for unknown paths', async () => {
    const url = await getAttachmentUrl('attachments/missing.png')
    expect(url).toBeNull()
  })

  test('mints a blob URL once and caches subsequent calls', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const path = await saveAttachment(blob, 'a.png')
    const url1 = await getAttachmentUrl(path)
    const url2 = await getAttachmentUrl(path)
    expect(url1).not.toBeNull()
    expect(url1).toBe(url2)
    expect(createSpy).toHaveBeenCalledTimes(1)
  })
})

// ── deleteAttachment ──────────────────────────────────────────────────────────

describe('deleteAttachment', () => {
  test('removes the IDB entry and revokes any cached URL', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const path = await saveAttachment(blob, 'a.png')
    const url = await getAttachmentUrl(path)
    expect(url).not.toBeNull()

    await deleteAttachment(path)
    expect(revokeSpy).toHaveBeenCalledWith(url)
    expect(await getAttachmentBlob(path)).toBeNull()
    expect(await getAttachmentUrl(path)).toBeNull()
  })
})
