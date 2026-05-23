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
  DEFAULT_ATTACHMENT_DIR,
  normalizeAttachmentDir,
  getAttachmentDir,
  getAttachmentPrefixes,
  listAttachmentPaths,
  listAttachmentMeta,
  putAttachmentAtPath,
  getAttachmentGitSha,
  getAttachmentTombstones,
  addAttachmentTombstone,
  clearAttachmentTombstones,
  _clearAttachmentUrlCache,
} from '../utils/attachments'
import { useSettingsStore } from '../stores/settingsStore'

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
  // Reset the configurable folder to the default so tests don't leak state.
  useSettingsStore.getState().setAttachmentsFolder(DEFAULT_ATTACHMENT_DIR)
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

  test('accepts both the configured folder and the historical default', () => {
    useSettingsStore.getState().setAttachmentsFolder('images')
    expect(isAttachmentPath('images/foo.png')).toBe(true)
    expect(isAttachmentPath('attachments/old.png')).toBe(true) // back-compat
    expect(isAttachmentPath('other/foo.png')).toBe(false)
  })

  test('supports nested configured paths', () => {
    useSettingsStore.getState().setAttachmentsFolder('assets/images')
    expect(isAttachmentPath('assets/images/foo.png')).toBe(true)
    expect(isAttachmentPath('assets/other.png')).toBe(false)
    expect(isAttachmentPath('attachments/legacy.png')).toBe(true) // still recognised
  })

})

// ── normalizeAttachmentDir ────────────────────────────────────────────────────

describe('normalizeAttachmentDir', () => {
  test('trims leading/trailing slashes and collapses repeats', () => {
    expect(normalizeAttachmentDir('/foo/bar/')).toBe('foo/bar')
    expect(normalizeAttachmentDir('foo//bar')).toBe('foo/bar')
    expect(normalizeAttachmentDir('  attachments  ')).toBe('attachments')
  })

  test('falls back to the default for empty / whitespace / null input', () => {
    expect(normalizeAttachmentDir('')).toBe(DEFAULT_ATTACHMENT_DIR)
    expect(normalizeAttachmentDir('  ')).toBe(DEFAULT_ATTACHMENT_DIR)
    expect(normalizeAttachmentDir(null)).toBe(DEFAULT_ATTACHMENT_DIR)
    expect(normalizeAttachmentDir(undefined)).toBe(DEFAULT_ATTACHMENT_DIR)
    expect(normalizeAttachmentDir('///')).toBe(DEFAULT_ATTACHMENT_DIR)
  })
})

// ── getAttachmentDir / getAttachmentPrefixes ─────────────────────────────────

describe('getAttachmentDir / getAttachmentPrefixes', () => {
  test('returns the configured folder', () => {
    useSettingsStore.getState().setAttachmentsFolder('images')
    expect(getAttachmentDir()).toBe('images')
  })

  test('prefix list contains only the default when the setting matches it', () => {
    useSettingsStore.getState().setAttachmentsFolder(DEFAULT_ATTACHMENT_DIR)
    expect(getAttachmentPrefixes()).toEqual([`${DEFAULT_ATTACHMENT_DIR}/`])
  })

  test('prefix list contains configured folder first plus the default for back-compat', () => {
    useSettingsStore.getState().setAttachmentsFolder('images')
    expect(getAttachmentPrefixes()).toEqual(['images/', `${DEFAULT_ATTACHMENT_DIR}/`])
  })
})

// ── saveAttachment honours the configured folder ─────────────────────────────

describe('saveAttachment with configured folder', () => {
  test('new saves land under the configured folder', async () => {
    useSettingsStore.getState().setAttachmentsFolder('images')
    const blob = new Blob(['x'], { type: 'image/png' })
    const path = await saveAttachment(blob, 'pic.png', new Date(2026, 4, 19, 9, 56, 12))
    expect(path).toBe('images/20260519095612-pic.png')
  })

  test('nested configured paths work', async () => {
    useSettingsStore.getState().setAttachmentsFolder('assets/images')
    const blob = new Blob(['x'], { type: 'image/png' })
    const path = await saveAttachment(blob, 'pic.png', new Date(2026, 4, 19, 9, 56, 12))
    expect(path).toBe('assets/images/20260519095612-pic.png')
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

  test('adds a tombstone so the next sync can delete the remote copy', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const path = await saveAttachment(blob, 'b.png')
    await deleteAttachment(path)
    expect(await getAttachmentTombstones()).toContain(path)
  })
})

// ── Tombstones ────────────────────────────────────────────────────────────────

describe('attachment tombstones', () => {
  test('addAttachmentTombstone is idempotent', async () => {
    await addAttachmentTombstone('attachments/a.png')
    await addAttachmentTombstone('attachments/a.png')
    expect(await getAttachmentTombstones()).toEqual(['attachments/a.png'])
  })

  test('clearAttachmentTombstones removes only the listed paths', async () => {
    await addAttachmentTombstone('attachments/a.png')
    await addAttachmentTombstone('attachments/b.png')
    await addAttachmentTombstone('attachments/c.png')
    await clearAttachmentTombstones(['attachments/a.png', 'attachments/c.png'])
    expect(await getAttachmentTombstones()).toEqual(['attachments/b.png'])
  })

  test('clearAttachmentTombstones with empty list is a no-op', async () => {
    await addAttachmentTombstone('attachments/a.png')
    await clearAttachmentTombstones([])
    expect(await getAttachmentTombstones()).toEqual(['attachments/a.png'])
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
