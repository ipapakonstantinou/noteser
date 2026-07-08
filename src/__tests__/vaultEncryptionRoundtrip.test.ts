/**
 * @jest-environment node
 *
 * End-to-end: push encrypts → pull decrypts. We exercise the wiring in
 * githubSync.ts (maybeEncryptForPush / maybeDecryptFromPull) by mocking
 * the network layer, unlocking the vault with a known passphrase, then
 * comparing what gets POSTed to /git/blobs against what comes back from
 * a subsequent getBlobContent fetch.
 */

import { syncToGitHub } from '../utils/githubSync'
import { generateSalt, saltToString, isEncryptedContent, decryptNoteContent, deriveKey } from '../utils/vaultCrypto'
import { unlockVault, lockVault, _resetVaultKeyForTests, VaultLockedError } from '../utils/vaultKey'
import type { Note, Folder, SyncRepo } from '@/types'

jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
  listAttachmentPathsTracked: async () => ({ value: [], timedOut: false }),
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
}))
jest.mock('../utils/lastPushedContent', () => ({
  setLastPushedContent: async () => undefined,
  getLastPushedContent: async () => null,
}))
// Mutable flag that the mocked store reads each call. Tests flip it
// via setMockEncryption(true|false).
const mockEncryptionEnabled = { value: false }
function setMockEncryption(v: boolean): void { mockEncryptionEnabled.value = v }

jest.mock('../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      localGitignoreOverlay: '',
      vaultEncryptionEnabled: mockEncryptionEnabled.value,
    }),
  },
}))

const REPO: SyncRepo = { owner: 'o', name: 'r', branch: 'main', isPrivate: true }
const PASSPHRASE = 'correct horse battery staple'

function makeNote(id: string, title: string, content: string): Note {
  return {
    id, title, content, folderId: null,
    createdAt: 0, updatedAt: 0, isDeleted: false, deletedAt: null,
    isPinned: false, templateId: null,
    gitPath: null, gitLastPushedSha: null,
  }
}

// Records bytes uploaded per path so we can read them back later.
function makeFetchMock() {
  const uploadedBlobs = new Map<string, string>() // sha → content
  let nextSha = 100
  let treePathToSha = new Map<string, string>() // path → blob sha (post-commit state)
  let pendingTreeEntries: Array<{ path: string; sha: string }> = []

  const fetchMock = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/git/refs/heads/main') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: 'parent-commit' } }), { status: 200 })
    }
    if (u.match(/\/git\/commits\/parent-commit/)) {
      return new Response(JSON.stringify({ tree: { sha: 'base-tree' } }), { status: 200 })
    }
    if (u.includes('/git/trees/base-tree?recursive=1')) {
      const tree = Array.from(treePathToSha.entries()).map(([path, sha]) => ({ path, type: 'blob', sha }))
      return new Response(JSON.stringify({ tree }), { status: 200 })
    }
    if (u.endsWith('/git/blobs') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { content: string }
      const sha = `blob-${nextSha++}`
      uploadedBlobs.set(sha, body.content)
      pendingTreeEntries.push({ path: '', sha })
      return new Response(JSON.stringify({ sha }), { status: 201 })
    }
    if (u.match(/\/git\/blobs\/blob-/)) {
      const sha = u.split('/').pop()!
      const content = uploadedBlobs.get(sha) ?? ''
      // Match createBlob's `encoding: 'utf-8'` behaviour — return as utf-8 string.
      return new Response(JSON.stringify({ content, encoding: 'utf-8' }), { status: 200 })
    }
    if (u.endsWith('/git/trees') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { tree: Array<{ path: string; sha: string }> }
      for (const entry of body.tree) {
        treePathToSha.set(entry.path, entry.sha)
      }
      pendingTreeEntries = []
      return new Response(JSON.stringify({ sha: 'new-tree' }), { status: 201 })
    }
    if (u.endsWith('/git/commits') && init?.method === 'POST') {
      return new Response(JSON.stringify({ sha: 'new-commit', html_url: 'https://x' }), { status: 201 })
    }
    if (u.includes('/git/refs/heads/main') && init?.method === 'PATCH') {
      return new Response(JSON.stringify({}), { status: 200 })
    }
    return new Response('not mocked: ' + u, { status: 500 })
  })

  return { fetchMock, uploadedBlobs, treePathToSha }
}

describe('vault encryption roundtrip', () => {
  beforeEach(() => {
    _resetVaultKeyForTests()
    setMockEncryption(false)
  })

  test('with encryption ON: pushed blob is wire-encoded, decryptable with the same passphrase', async () => {
    const salt = generateSalt()
    setMockEncryption(true)
    await unlockVault(PASSPHRASE, saltToString(salt))

    const { fetchMock, uploadedBlobs } = makeFetchMock()
    global.fetch = fetchMock as unknown as typeof fetch

    await syncToGitHub({
      token: 't',
      repo: REPO,
      notes: [makeNote('1', 'A', 'Secret note body 🔐')],
      folders: [] as Folder[],
    })

    expect(uploadedBlobs.size).toBe(1)
    const [[, raw]] = Array.from(uploadedBlobs.entries())
    expect(isEncryptedContent(raw)).toBe(true)

    // A peer with the same passphrase + salt can read it.
    const key = await deriveKey(PASSPHRASE, salt)
    const decoded = await decryptNoteContent(raw, key)
    expect(decoded).toBe('Secret note body 🔐\n') // normalizeForPush adds a trailing \n
  })

  test('with encryption OFF: pushed blob is plain markdown (back-compat)', async () => {
    const { fetchMock, uploadedBlobs } = makeFetchMock()
    global.fetch = fetchMock as unknown as typeof fetch

    await syncToGitHub({
      token: 't',
      repo: REPO,
      notes: [makeNote('1', 'A', 'just plain text')],
      folders: [] as Folder[],
    })

    expect(uploadedBlobs.size).toBe(1)
    const [[, raw]] = Array.from(uploadedBlobs.entries())
    expect(isEncryptedContent(raw)).toBe(false)
    expect(raw).toContain('just plain text')
  })

  test('with encryption ON but vault locked: push throws VaultLockedError', async () => {
    setMockEncryption(true)
    lockVault()

    const { fetchMock } = makeFetchMock()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(syncToGitHub({
      token: 't',
      repo: REPO,
      notes: [makeNote('1', 'A', 'cannot push')],
      folders: [] as Folder[],
    })).rejects.toBeInstanceOf(VaultLockedError)
  })
})
