/**
 * @jest-environment node
 *
 * Push progress + upload-cache coverage for syncToGitHub.
 *
 * We mock the network layer (githubFetch) rather than the higher-level
 * github.ts helpers so the contract under test is the real one:
 *
 *   - The push emits progress events in order: computing →
 *     uploading-blobs (with running count) → creating-tree →
 *     creating-commit → updating-ref → done.
 *   - When a blob upload fails partway through, a retry of syncToGitHub
 *     (same tab, same repo) skips the blobs the first attempt already
 *     uploaded — confirmed by counting fetch calls to /git/blobs.
 *
 * Notes are intentionally tiny — we're testing the bookkeeping, not the
 * encoder.
 */

import { syncToGitHub, _resetUploadedShaCache } from '../utils/githubSync'
import type { PushProgress } from '../utils/githubSync'
import type { Note, Folder, SyncRepo } from '@/types'

// Stub IDB-backed helpers that syncToGitHub touches indirectly via
// dynamic imports. Jest's module mocks intercept them.
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
jest.mock('../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ localGitignoreOverlay: '' }) },
}))

const REPO: SyncRepo = { owner: 'o', name: 'r', branch: 'main', isPrivate: true }

function makeNote(id: string, title: string, content: string): Note {
  return {
    id,
    title,
    content,
    folderId: null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: null,
    gitLastPushedSha: null,
  }
}

// Each fetch call lands here. The handlers below dispatch based on URL.
function makeFetchMock(opts: {
  onCreateBlob?: (attemptIdx: number) => Promise<Response> | Response
  remoteTreeBlobs?: Map<string, string>
} = {}) {
  let blobAttempt = 0
  const remoteBlobs = opts.remoteTreeBlobs ?? new Map()
  const createBlobHandler = opts.onCreateBlob ?? (() => new Response(JSON.stringify({ sha: `blob-${blobAttempt}` }), { status: 201 }))

  return jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    // GET branch ref → parent commit sha
    if (u.includes('/git/refs/heads/main')) {
      return new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: 'parent-commit' } }), { status: 200 })
    }
    // GET commit → tree sha
    if (u.match(/\/git\/commits\/parent-commit/)) {
      return new Response(JSON.stringify({ tree: { sha: 'base-tree' } }), { status: 200 })
    }
    // GET tree recursive
    if (u.includes('/git/trees/base-tree?recursive=1')) {
      const tree = Array.from(remoteBlobs.entries()).map(([path, sha]) => ({ path, type: 'blob', sha }))
      return new Response(JSON.stringify({ tree }), { status: 200 })
    }
    // POST /git/blobs — only when CREATING (init.method === 'POST'). The
    // create handler is allowed to throw / 5xx so we can simulate partial
    // failure.
    if (u.endsWith('/git/blobs') && init?.method === 'POST') {
      blobAttempt++
      return createBlobHandler(blobAttempt - 1)
    }
    // POST /git/trees
    if (u.endsWith('/git/trees') && init?.method === 'POST') {
      return new Response(JSON.stringify({ sha: 'new-tree' }), { status: 201 })
    }
    // POST /git/commits
    if (u.endsWith('/git/commits') && init?.method === 'POST') {
      return new Response(JSON.stringify({ sha: 'new-commit', html_url: 'https://github.com/x' }), { status: 201 })
    }
    // PATCH /git/refs/heads/main
    if (u.includes('/git/refs/heads/main') && init?.method === 'PATCH') {
      return new Response(JSON.stringify({}), { status: 200 })
    }
    return new Response('not mocked: ' + u, { status: 500 })
  })
}

describe('syncToGitHub — push progress events', () => {
  beforeEach(() => { _resetUploadedShaCache() })

  test('emits the full phase sequence on a clean push of 2 new notes', async () => {
    const fetchMock = makeFetchMock()
    global.fetch = fetchMock as unknown as typeof fetch
    const phases: PushProgress[] = []
    await syncToGitHub({
      token: 't',
      repo: REPO,
      notes: [makeNote('1', 'A', 'aaaa'), makeNote('2', 'B', 'bbbb')],
      folders: [] as Folder[],
      onProgress: e => { phases.push(e) },
    })

    expect(phases[0]).toEqual({ phase: 'computing' })
    // At least one uploading-blobs event with total === 2.
    const uploading = phases.filter((p): p is Extract<PushProgress, { phase: 'uploading-blobs' }> => p.phase === 'uploading-blobs')
    expect(uploading.length).toBeGreaterThan(0)
    expect(uploading[0].total).toBe(2)
    expect(uploading[uploading.length - 1].uploaded).toBe(2)
    expect(uploading[uploading.length - 1].skipped).toBe(0)

    // Order check: every "uploading-blobs" event must precede tree/commit/ref/done.
    const phaseOrder = phases.map(p => p.phase)
    expect(phaseOrder).toEqual(expect.arrayContaining(['creating-tree', 'creating-commit', 'updating-ref', 'done']))
    expect(phaseOrder.indexOf('creating-tree')).toBeGreaterThan(phaseOrder.lastIndexOf('uploading-blobs'))
    expect(phaseOrder.indexOf('done')).toBe(phaseOrder.length - 1)
  })

  test('upload cache: retry after partial failure skips uploaded blobs', async () => {
    // Push 3 notes. The first blob upload succeeds, the second 5xx's
    // (after exhausting githubFetch's own retries), the third never
    // runs because the loop throws first. The retry call sees the cache
    // and skips the first blob.
    const failedOnce = { fired: false }
    const fetchMock = makeFetchMock({
      onCreateBlob: (idx) => {
        if (idx === 0) {
          return new Response(JSON.stringify({ sha: 'sha-A' }), { status: 201 })
        }
        // 422 is non-transient — githubFetch returns it immediately
        // without burning real setTimeout, and ensureOk throws.
        failedOnce.fired = true
        return new Response(JSON.stringify({ message: 'simulated' }), { status: 422 })
      },
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const notes = [makeNote('1', 'A', 'aa'), makeNote('2', 'B', 'bb'), makeNote('3', 'C', 'cc')]

    // First attempt — expect a thrown error mid-loop.
    await expect(syncToGitHub({
      token: 't',
      repo: REPO,
      notes,
      folders: [] as Folder[],
    })).rejects.toThrow()
    expect(failedOnce.fired).toBe(true)

    // Retry: make every blob upload succeed. The cache should mean
    // blob A is NOT re-uploaded.
    fetchMock.mockClear()
    let calls = 0
    global.fetch = (jest.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/git/blobs') && init?.method === 'POST') {
        calls++
        return new Response(JSON.stringify({ sha: `sha-retry-${calls}` }), { status: 201 })
      }
      // Reuse the prior tree-reading handlers via the original mock.
      return fetchMock(url, init)
    })) as unknown as typeof fetch

    await syncToGitHub({
      token: 't',
      repo: REPO,
      notes,
      folders: [] as Folder[],
    })
    // Notes 2 + 3 are not in the cache (their localSha was never
    // successfully uploaded). Note 1 is in the cache and should NOT be
    // re-uploaded. So expect exactly 2 createBlob POSTs.
    expect(calls).toBe(2)
  })

  test('cache is cleared after a successful push', async () => {
    const fetchMock = makeFetchMock()
    global.fetch = fetchMock as unknown as typeof fetch
    const notes = [makeNote('1', 'A', 'one')]
    await syncToGitHub({ token: 't', repo: REPO, notes, folders: [] as Folder[] })

    // Force a deliberate cache miss by changing the remote tree's view.
    // The 2nd push should upload again because the cache is empty.
    const fetchMock2 = makeFetchMock()
    global.fetch = fetchMock2 as unknown as typeof fetch
    await syncToGitHub({ token: 't', repo: REPO, notes, folders: [] as Folder[] })
    const blobPosts2 = fetchMock2.mock.calls.filter(c => String(c[0]).endsWith('/git/blobs') && (c[1] as RequestInit | undefined)?.method === 'POST').length
    expect(blobPosts2).toBe(1)
  })
})
