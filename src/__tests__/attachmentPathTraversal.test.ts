/**
 * attachmentPathTraversal.test.ts
 *
 * An attachment path can come from a collab peer (the `attachments` Y.Map key,
 * relayed by collabExtension) or from the repo, and every stored path is later
 * pushed verbatim as a tree entry by syncPush. `isAttachmentPath` is a
 * `startsWith` over the folder prefixes, so it accepts
 * `attachments/../../.github/workflows/pwn.yml` — which is a file the victim's
 * next sync would commit for them.
 *
 * These cases pin the guard: the predicate itself, and the sink refusing to
 * write when the predicate says no.
 */

const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (k: string) => idb.get(k)),
  set: jest.fn(async (k: string, v: unknown) => { idb.set(k, v) }),
  del: jest.fn(async (k: string) => { idb.delete(k) }),
  keys: jest.fn(async () => Array.from(idb.keys())),
}))

import {
  isAttachmentPath,
  isSafeAttachmentPath,
  putAttachmentAtPath,
  UnsafeAttachmentPathError,
} from '../utils/attachments'
import { useSettingsStore } from '../stores/settingsStore'

beforeEach(() => {
  idb.clear()
  // Default folder — `attachments/` is then the only recognised prefix.
  useSettingsStore.setState({ attachmentsFolder: 'attachments' })
})

describe('isSafeAttachmentPath — rejects', () => {
  const bad: Array<[string, string]> = [
    ['traversal out of the folder', 'attachments/../../.github/workflows/pwn.yml'],
    ['single-level traversal', 'attachments/../pwn.yml'],
    ['a dot segment', 'attachments/./pwn.png'],
    ['an absolute path', '/attachments/pwn.png'],
    ['backslash separators', 'attachments\\..\\pwn.yml'],
    ['an empty segment', 'attachments//pwn.png'],
    ['a trailing slash', 'attachments/'],
    ['percent-encoded traversal', 'attachments/%2e%2e/%2e%2e/pwn.yml'],
    ['half-encoded traversal', 'attachments/..%2fpwn.yml'],
    ['double-encoded traversal', 'attachments/%252e%252e/pwn.yml'],
    ['the empty string', ''],
    ['an absurdly long path', `attachments/${'a'.repeat(500)}.png`],
  ]

  test.each(bad)('%s', (_label, path) => {
    expect(isSafeAttachmentPath(path)).toBe(false)
  })

  test('a NUL byte anywhere in the path', () => {
    expect(isSafeAttachmentPath(`attachments/pwn${String.fromCharCode(0)}.png`)).toBe(false)
  })
})

describe('isSafeAttachmentPath — accepts what the app itself writes', () => {
  test.each([
    ['a plain attachment', 'attachments/Pasted image 20260730.png'],
    ['a nested folder', 'attachments/feature-tour/editor.png'],
    ['a literal percent in the filename', 'attachments/100% done.png'],
    ['a malformed escape, which is a legal literal name', 'attachments/%zz.png'],
    ['a name with spaces and an ampersand', 'attachments/a & b.png'],
  ])('%s', (_label, path) => {
    expect(isSafeAttachmentPath(path)).toBe(true)
  })

  test('a path outside the attachments folder is SHAPE-safe — folder membership is a separate check', () => {
    // Deliberate: the sink cannot require the folder, or a vault whose
    // attachments folder was renamed twice could not re-write its own older
    // attachments. Untrusted callers add isAttachmentPath — see
    // collabAttachmentRelay.test.ts for the peer-relay case.
    expect(isSafeAttachmentPath('.github/workflows/pwn.yml')).toBe(true)
    expect(isAttachmentPath('.github/workflows/pwn.yml')).toBe(false)

    useSettingsStore.setState({ attachmentsFolder: 'Files' })
    expect(isAttachmentPath('Files/a.png')).toBe(true)
    // Refs written before the rename still resolve, so they stay writable.
    expect(isAttachmentPath('attachments/a.png')).toBe(true)
    expect(isAttachmentPath('Notes/a.png')).toBe(false)
  })
})

describe('putAttachmentAtPath — the sink refuses', () => {
  test('writes nothing for a traversal path', async () => {
    await expect(
      putAttachmentAtPath('attachments/../../.github/workflows/pwn.yml', new Blob(['x'])),
    ).rejects.toThrow(UnsafeAttachmentPathError)

    expect(Array.from(idb.keys())).toHaveLength(0)
  })

  test('still writes a legitimate attachment', async () => {
    await putAttachmentAtPath('attachments/ok.png', new Blob(['x'], { type: 'image/png' }))

    expect(Array.from(idb.keys())).toContain('noteser-attachment:attachments/ok.png')
  })
})
