/**
 * treeTruncation.test.ts
 *
 * GitHub caps a recursive tree read and flags it with `truncated: true`
 * instead of paginating. Classifying against a partial tree makes every note
 * that fell off the end look `remoteDeleted` (syncPull.ts step 2) → soft
 * delete → a real deletion on the next push. So a truncated read has to fail
 * the pull, and must never land in the ETag cache where a later 304 would
 * serve the partial picture back.
 *
 * Covered:
 *   1. getTreeMap throws TreeTruncatedError on a truncated response.
 *   2. The cached read (cold, no ETag) throws and writes nothing.
 *   3. The cached read (warm ETag, 200 truncated) throws and leaves the
 *      previously cached full tree untouched.
 *   4. pullFromGitHub aborts before any blob read — nothing to apply.
 */

// idb-keyval as an inspectable in-memory map: the ETag cache's cold tier.
const idbStore = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (k: string) => idbStore.get(k)),
  set: jest.fn(async (k: string, v: unknown) => { idbStore.set(k, v) }),
  del: jest.fn(async (k: string) => { idbStore.delete(k) }),
  keys: jest.fn(async () => Array.from(idbStore.keys())),
}))

const mockGithubFetch = jest.fn()
jest.mock('../utils/githubFetch', () => ({
  githubFetch: (...a: unknown[]) => mockGithubFetch(...a),
}))

import { getTreeMap, TreeTruncatedError } from '../utils/github'
import { getTreeMapConditional, _resetETagCache } from '../utils/githubETagCache'
import { pullFromGitHub } from '../utils/githubSync'
import { GitHubProvider } from '../utils/gitHost/githubProvider'
import type { Note, SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'jon', name: 'vault', branch: 'main', isPrivate: false }
const TOKEN = 'gho_test'
const TREE_SHA = 'tree-sha-1'
const TREE_KEY = `noteser:gh-etag:tree2:${REPO.owner}/${REPO.name}:${TREE_SHA}`

// A truncated reply that still carries entries — the dangerous shape: it looks
// like a valid (just smaller) vault.
const TRUNCATED = {
  truncated: true,
  tree: [{ path: 'Kept.md', type: 'blob', sha: 'sha-kept' }],
}

// Minimal stand-in for a 200 Response — jsdom ships no Response and this only
// needs the four members the read paths touch.
function jsonRes(body: unknown, headers: Record<string, string> = {}): Response {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: (k: string) => h.get(k.toLowerCase()) ?? null,
      has: (k: string) => h.has(k.toLowerCase()),
    },
  } as unknown as Response
}

beforeEach(() => {
  idbStore.clear()
  _resetETagCache()
  mockGithubFetch.mockReset()
})

test('getTreeMap rejects a truncated tree instead of returning a partial map', async () => {
  mockGithubFetch.mockResolvedValue(jsonRes(TRUNCATED))

  await expect(getTreeMap(TOKEN, REPO.owner, REPO.name, TREE_SHA))
    .rejects.toThrow(TreeTruncatedError)
})

test('cached read: a truncated tree is never written to the ETag cache', async () => {
  mockGithubFetch.mockResolvedValue(jsonRes(TRUNCATED))

  await expect(getTreeMapConditional(TOKEN, REPO, TREE_SHA))
    .rejects.toThrow(TreeTruncatedError)
  expect(idbStore.has(TREE_KEY)).toBe(false)
})

test('cached read: a truncated 200 does not overwrite the cached full tree', async () => {
  const cached = {
    etag: 'W/"full"',
    tree: [['Kept.md', 'sha-kept'], ['Gone.md', 'sha-gone']],
  }
  idbStore.set(TREE_KEY, cached)
  mockGithubFetch.mockResolvedValue(jsonRes(TRUNCATED, { etag: 'W/"partial"' }))

  await expect(getTreeMapConditional(TOKEN, REPO, TREE_SHA))
    .rejects.toThrow(TreeTruncatedError)
  expect(idbStore.get(TREE_KEY)).toEqual(cached)
})

test('pullFromGitHub aborts on a truncated tree and reads no blobs', async () => {
  const urls: string[] = []
  mockGithubFetch.mockImplementation(async (url: unknown) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('/git/refs/heads/')) {
      return jsonRes({ ref: 'refs/heads/main', object: { sha: 'head-sha' } })
    }
    if (u.includes('/git/commits/')) return jsonRes({ tree: { sha: TREE_SHA } })
    if (u.includes('/git/trees/')) return jsonRes(TRUNCATED)
    throw new Error(`unexpected fetch: ${u}`)
  })

  // A note whose remote file exists but fell off the truncated end. Without
  // the guard this pull classifies it remoteDeleted.
  const notes = [{
    id: 'n1',
    title: 'Gone',
    content: 'still here locally',
    folderId: null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: 'Gone.md',
    gitLastPushedSha: 'sha-gone',
    gitRemoteBaseSha: 'sha-gone',
  } as Note]

  await expect(pullFromGitHub({
    provider: new GitHubProvider(TOKEN), repo: REPO, notes, folders: [],
  })).rejects.toThrow(TreeTruncatedError)

  expect(urls.filter(u => u.includes('/git/blobs/'))).toHaveLength(0)
})
