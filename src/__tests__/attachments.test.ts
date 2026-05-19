/**
 * attachments.test.ts
 *
 * Covers the IDB-backed attachment store used by image drag-and-drop. We mock
 * idb-keyval with an in-memory Map so save/get/del round-trip in isolation,
 * and we stub URL.createObjectURL / revokeObjectURL since jsdom doesn't
 * implement them.
 */

// ── Web-API polyfills ─────────────────────────────────────────────────────────
// jsdom doesn't ship TextEncoder/Decoder or crypto.subtle. Polyfill from Node
// before any module-under-test imports so the SHA computation path works.
import { TextEncoder, TextDecoder } from 'util'
import { webcrypto } from 'crypto'
if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder
}
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true })
}

// ── idb-keyval mock ───────────────────────────────────────────────────────────
const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((key: string) => Promise.resolve(idb.get(key))),
  set: jest.fn((key: string, value: unknown) => { idb.set(key, value); return Promise.resolve() }),
  del: jest.fn((key: string) => { idb.delete(key); return Promise.resolve() }),
  keys: jest.fn(() => Promise.resolve([...idb.keys()])),
}))

import {
  saveAttachment,
  getAttachmentBlob,
  getAttachmentUrl,
  deleteAttachment,
  sanitizeAttachmentName,
  isAttachmentPath,
  ATTACHMENT_DIR,
  listAttachmentPaths,
  listAttachmentMeta,
  putAttachmentAtPath,
  getAttachmentGitSha,
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
  // jsdom's Blob also lacks .arrayBuffer(). Polyfill via FileReader.
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      value: function (this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error)
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.readAsArrayBuffer(this)
        })
      },
      writable: true,
    })
  }
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

// ── listAttachmentPaths / listAttachmentMeta ──────────────────────────────────

describe('listAttachmentPaths', () => {
  test('returns only paths under the noteser-attachment: prefix, sorted', async () => {
    // Drop a non-attachment key in IDB to confirm it gets filtered.
    idb.set('unrelated-key', { foo: 'bar' })
    await saveAttachment(new Blob(['x']), 'b.png', new Date(2026, 4, 19, 9, 56, 12))
    await saveAttachment(new Blob(['x']), 'a.png', new Date(2026, 4, 19, 9, 56, 13))

    const paths = await listAttachmentPaths()
    expect(paths).toEqual([
      'attachments/20260519095612-b.png',
      'attachments/20260519095613-a.png',
    ])
  })
})

describe('listAttachmentMeta', () => {
  test('returns size + mime + original name + createdAt for each attachment', async () => {
    const blob = new Blob(['hello'], { type: 'image/png' })
    const path = await saveAttachment(blob, 'a.png')
    const meta = await listAttachmentMeta()
    expect(meta).toHaveLength(1)
    expect(meta[0]).toMatchObject({
      path,
      size: 5,
      mime: 'image/png',
      originalName: 'a.png',
    })
    expect(typeof meta[0].createdAt).toBe('number')
  })
})

// ── putAttachmentAtPath ───────────────────────────────────────────────────────

describe('putAttachmentAtPath', () => {
  test('writes a blob at a specific path and revokes any cached URL', async () => {
    const blob = new Blob(['old'], { type: 'image/png' })
    const path = 'attachments/remote-foo.png'
    await putAttachmentAtPath(path, blob)
    expect(await getAttachmentBlob(path)).toBe(blob)

    // Mint a URL so the next put-at-path triggers revocation.
    const url = await getAttachmentUrl(path)
    expect(url).not.toBeNull()

    const newBlob = new Blob(['new'], { type: 'image/png' })
    await putAttachmentAtPath(path, newBlob)
    expect(revokeSpy).toHaveBeenCalledWith(url)
    expect(await getAttachmentBlob(path)).toBe(newBlob)
  })
})

// ── getAttachmentGitSha ───────────────────────────────────────────────────────

describe('getAttachmentGitSha', () => {
  test('returns null for unknown paths', async () => {
    expect(await getAttachmentGitSha('attachments/missing.png')).toBeNull()
  })

  test('computes git blob SHA-1 (`blob <len>\\0<bytes>`) for stored content', async () => {
    // Known git SHA-1 for an empty blob: e69de29bb2d1d6434b8b29ae775ad8c2e48c5391.
    const path = await saveAttachment(new Blob([]), 'empty.bin')
    expect(await getAttachmentGitSha(path)).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  })
})
