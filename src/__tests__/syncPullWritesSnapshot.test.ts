/**
 * syncPullWritesSnapshot.test.ts (#68 — offline-first Step 1)
 *
 * pullFromGitHub records a vault snapshot after a successful classify so
 * the next boot can detect cache hits and surface a "cached at <sha>"
 * status when offline. This test wires the orchestrator against
 * deterministic GitHub mocks and asserts:
 *
 *   1. The snapshot is written under the per-repo key.
 *   2. The snapshot carries the real head commit SHA, not the tree SHA.
 *   3. The snapshot's treeMap contains every path the recursive tree had.
 *
 * The snapshot write is fire-and-forget inside pullFromGitHub (a write
 * failure must not fail the sync), so we poll briefly in `awaitWrite()`
 * to let the dynamic import + `set()` resolve.
 */

// idb-keyval mock — captures writes so we can inspect the cache entry.
const idbBackingStore = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (k: string) => idbBackingStore.get(k)),
  set: jest.fn(async (k: string, v: unknown) => { idbBackingStore.set(k, v) }),
  del: jest.fn(async (k: string) => { idbBackingStore.delete(k) }),
  keys: jest.fn(async () => Array.from(idbBackingStore.keys())),
}))

const mockGetBranchRefSha = jest.fn()
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()
const mockGitBlobSha = jest.fn()

jest.mock('../utils/github', () => ({
  getBranchRefSha:   (...a: unknown[]) => mockGetBranchRefSha(...a),
  getCommitTreeSha:  (...a: unknown[]) => mockGetCommitTreeSha(...a),
  getTreeMap:        (...a: unknown[]) => mockGetTreeMap(...a),
  getBlobContent:    (...a: unknown[]) => mockGetBlobContent(...a),
  gitBlobSha:        (...a: unknown[]) => mockGitBlobSha(...a),
  gitBlobShaBytes:   jest.fn(),
  createBlob:        jest.fn(),
  createBlobBinary:  jest.fn(),
  createTree:        jest.fn(),
  createCommit:      jest.fn(),
  updateBranchRef:   jest.fn(),
  fetchZipball:      jest.fn(),
  blobToBase64:      jest.fn(),
}))

import { pullFromGitHub } from '../utils/githubSync'
import { GitHubProvider } from '../utils/gitHost/githubProvider'
import { VAULT_CACHE_KEY_PREFIX } from '../utils/vaultSnapshotCache'
import type { Note, SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }

function note(input: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: input.id,
    title: input.title,
    content: input.content ?? '',
    folderId: input.folderId ?? null,
    createdAt: 0,
    updatedAt: input.updatedAt ?? 0,
    isDeleted: input.isDeleted ?? false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: input.gitPath ?? null,
    gitLastPushedSha: input.gitLastPushedSha ?? null,
    gitRemoteBaseSha: input.gitRemoteBaseSha ?? null,
  } as Note
}

async function awaitWrite(key: string, timeoutMs = 1000): Promise<unknown> {
  // pullFromGitHub kicks the snapshot write via `void (async () => {...})()`
  // — give it a few ticks to land. Poll instead of using fixed sleeps so
  // CI doesn't flake on slow machines.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = idbBackingStore.get(key)
    if (v !== undefined) return v
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return idbBackingStore.get(key)
}

beforeEach(async () => {
  jest.clearAllMocks()
  idbBackingStore.clear()
  mockGetBranchRefSha.mockResolvedValue('head-sha-7')
  mockGetCommitTreeSha.mockResolvedValue('tree-sha-7')
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: '' })
})

test('records a vault snapshot under noteser-vault-cache:<owner>/<name>', async () => {
  const tree = new Map<string, string>([
    ['Foo.md', 'sha-foo'],
    ['notes/Bar.md', 'sha-bar'],
  ])
  mockGetTreeMap.mockResolvedValue(tree)
  mockGitBlobSha.mockResolvedValue('sha-foo') // makes Foo.md classify as unchanged
  mockGetBlobContent.mockResolvedValue('# Bar')

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: 'body', gitPath: 'Foo.md', gitLastPushedSha: 'sha-foo' }),
  ]

  await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  const key = `${VAULT_CACHE_KEY_PREFIX}${REPO.owner}/${REPO.name}`
  const snap = (await awaitWrite(key)) as { commitSha: string; treeMap: Array<[string, string]>; syncedAt: number }
  expect(snap).toBeDefined()
  // The snapshot anchors against the COMMIT, not the tree (tree SHA changes
  // independently when files are re-arranged but the same commit owns
  // both).
  expect(snap.commitSha).toBe('head-sha-7')
  // Tree map is the same path/sha pairs the pull saw.
  expect(snap.treeMap).toEqual(expect.arrayContaining([
    ['Foo.md', 'sha-foo'],
    ['notes/Bar.md', 'sha-bar'],
  ]))
  expect(typeof snap.syncedAt).toBe('number')
})

test('subsequent pulls overwrite the snapshot (SHA-driven invalidation)', async () => {
  // First pull writes commit head-sha-7.
  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-foo']]))
  mockGitBlobSha.mockResolvedValue('sha-foo')
  await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO,
    notes: [note({ id: '1', title: 'Foo', content: 'body', gitPath: 'Foo.md', gitLastPushedSha: 'sha-foo' })],
    folders: [],
  })
  const key = `${VAULT_CACHE_KEY_PREFIX}${REPO.owner}/${REPO.name}`
  const first = (await awaitWrite(key)) as { commitSha: string }
  expect(first.commitSha).toBe('head-sha-7')

  // Remote moved: new HEAD, same path with a new blob sha.
  mockGetBranchRefSha.mockResolvedValue('head-sha-8')
  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-foo-2']]))
  mockGetBlobContent.mockResolvedValue('# Foo updated')
  // local note still at sha-foo → triggers remoteUpdated; either way the
  // pull writes the snapshot at the end.
  mockGitBlobSha.mockResolvedValue('sha-foo')
  await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO,
    notes: [note({ id: '1', title: 'Foo', content: 'body', gitPath: 'Foo.md', gitLastPushedSha: 'sha-foo' })],
    folders: [],
  })
  // Poll for the second write — it overwrites the first.
  const deadline = Date.now() + 1000
  let snap: { commitSha: string } | undefined
  while (Date.now() < deadline) {
    const v = idbBackingStore.get(key) as { commitSha: string } | undefined
    if (v && v.commitSha === 'head-sha-8') { snap = v; break }
    await new Promise(r => setTimeout(r, 5))
  }
  expect(snap?.commitSha).toBe('head-sha-8')
})
