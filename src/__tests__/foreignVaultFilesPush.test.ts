/**
 * @jest-environment node
 *
 * foreignVaultFilesPush.test.ts
 *
 * The push pipeline MUST never include a `kind: 'foreign'` note. A foreign
 * note is a read-only mirror of a non-md remote vault file (e.g. `.canvas`,
 * `.base`); its `content` is intentionally empty. Pushing it would (a) upload
 * an empty blob over the real remote file, and (b) — if only filtered from
 * the `desired` set — trigger the deletion loop and emit a `sha: null` DELETE
 * for the real file. Both outcomes are data loss, so the filter is critical.
 *
 * Strategy mirrors pushOnlyRealEdits.test.ts: mock the network surface via
 * global.fetch, keep gitBlobSha real, drive syncToGitHub directly.
 */

import { syncToGitHub, _resetUploadedShaCache } from '../utils/githubSync'
import type { Note, Folder, SyncRepo } from '@/types'

jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
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
  useSettingsStore: { getState: () => ({ localGitignoreOverlay: '', vaultEncryptionEnabled: false }) },
}))

const REPO: SyncRepo = { owner: 'o', name: 'r', branch: 'main', isPrivate: true }

function makeNote(id: string, title: string, content: string, extra: Partial<Note> = {}): Note {
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
    gitRemoteBaseSha: null,
    kind: 'markdown',
    ...extra,
  }
}

interface TreeEntry { path: string; sha: string | null }

function makeFetchMock(remoteBlobs: Map<string, string>) {
  const record = {
    treeEntriesPosted: null as TreeEntry[] | null,
    blobsCreated: [] as string[],
    commitCreated: false,
    refUpdated: false,
  }
  const fetchMock = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/git/refs/heads/main') && init?.method === 'PATCH') {
      record.refUpdated = true
      return new Response(JSON.stringify({}), { status: 200 })
    }
    if (u.includes('/git/refs/heads/main')) {
      return new Response(JSON.stringify({ ref: 'refs/heads/main', object: { sha: 'parent-commit' } }), { status: 200 })
    }
    if (u.match(/\/git\/commits\/parent-commit/)) {
      return new Response(JSON.stringify({ tree: { sha: 'base-tree' } }), { status: 200 })
    }
    if (u.includes('/git/trees/base-tree?recursive=1')) {
      const tree = Array.from(remoteBlobs.entries()).map(([path, sha]) => ({ path, type: 'blob', sha }))
      return new Response(JSON.stringify({ tree }), { status: 200 })
    }
    if (u.endsWith('/git/blobs') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { content: string }
      const sha = `created-blob-${record.blobsCreated.length}`
      record.blobsCreated.push(body.content)
      return new Response(JSON.stringify({ sha }), { status: 201 })
    }
    if (u.endsWith('/git/trees') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { tree: TreeEntry[] }
      record.treeEntriesPosted = body.tree
      return new Response(JSON.stringify({ sha: 'new-tree' }), { status: 201 })
    }
    if (u.endsWith('/git/commits') && init?.method === 'POST') {
      record.commitCreated = true
      return new Response(JSON.stringify({ sha: 'new-commit', html_url: 'https://github.com/x' }), { status: 201 })
    }
    return new Response('not mocked: ' + u, { status: 500 })
  })
  return { fetchMock, record }
}

describe('syncToGitHub — foreign-kind notes never appear in the push plan', () => {
  beforeEach(() => { _resetUploadedShaCache() })

  test('a foreign mirror is excluded from desired AND from the deletion loop (no blob, no delete, no commit)', async () => {
    // A live remote file at Untitled.canvas with a sha; a local foreign mirror
    // pointing at the same gitPath. The mirror's content is empty (read-only)
    // and a naive push would either upload empty bytes over the remote OR
    // emit a sha:null delete. Neither must happen.
    const remoteSha = 'sha-canvas'
    const foreignMirror = makeNote('foreign-1', 'Untitled.canvas', '', {
      kind: 'foreign',
      gitPath: 'Untitled.canvas',
      gitLastPushedSha: remoteSha,
      gitRemoteBaseSha: remoteSha,
    })

    const { fetchMock, record } = makeFetchMock(new Map([['Untitled.canvas', remoteSha]]))
    global.fetch = fetchMock as unknown as typeof fetch

    const outcome = await syncToGitHub({
      token: 't',
      repo: REPO,
      notes: [foreignMirror],
      folders: [] as Folder[],
    })

    // Nothing pushed: no blobs created, no tree posted (the empty-entries
    // early-return triggers), no commit, no ref update.
    expect(record.blobsCreated).toEqual([])
    expect(record.treeEntriesPosted).toBeNull()
    expect(record.commitCreated).toBe(false)
    expect(record.refUpdated).toBe(false)

    // Outcome reads as a clean no-op.
    expect(outcome.result.unchanged).toBe(true)
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    expect(outcome.pathUpdates).toEqual([])
  })

  test('a soft-deleted foreign mirror does NOT emit a remote delete (read-only mirror is immutable)', async () => {
    // The mirror's local entry was marked deleted. A normal markdown note in
    // this state would emit a sha:null tree entry for its gitPath. Foreign
    // mirrors must be skipped here too — the user has no business deleting a
    // file we cannot edit, and the safety guarantee is unconditional.
    const remoteSha = 'sha-canvas'
    const foreignMirror = makeNote('foreign-1', 'Untitled.canvas', '', {
      kind: 'foreign',
      gitPath: 'Untitled.canvas',
      gitLastPushedSha: remoteSha,
      gitRemoteBaseSha: remoteSha,
      isDeleted: true,
      deletedAt: 1,
    })

    const { fetchMock, record } = makeFetchMock(new Map([['Untitled.canvas', remoteSha]]))
    global.fetch = fetchMock as unknown as typeof fetch

    const outcome = await syncToGitHub({
      token: 't',
      repo: REPO,
      notes: [foreignMirror],
      folders: [] as Folder[],
    })

    expect(record.blobsCreated).toEqual([])
    expect(record.treeEntriesPosted).toBeNull()
    expect(record.commitCreated).toBe(false)
    expect(outcome.result.deleted).toBe(0)
    expect(outcome.pathUpdates).toEqual([])
  })

  test('a markdown note PLUS a foreign mirror: only the markdown participates (regression guard)', async () => {
    // Sanity-check the filter doesn't accidentally drop markdown notes that
    // happen to live alongside foreign mirrors. New markdown note (no gitPath)
    // should push as a creation; the foreign mirror should not.
    const remoteSha = 'sha-canvas'
    const md = makeNote('md-1', 'Real note', 'Hello\n')
    const foreignMirror = makeNote('foreign-1', 'Untitled.canvas', '', {
      kind: 'foreign',
      gitPath: 'Untitled.canvas',
      gitLastPushedSha: remoteSha,
      gitRemoteBaseSha: remoteSha,
    })

    const { fetchMock, record } = makeFetchMock(new Map([['Untitled.canvas', remoteSha]]))
    global.fetch = fetchMock as unknown as typeof fetch

    const outcome = await syncToGitHub({
      token: 't',
      repo: REPO,
      notes: [md, foreignMirror],
      folders: [] as Folder[],
    })

    // Exactly one blob created (the markdown note), exactly one tree entry,
    // exactly one created path. Foreign mirror's path is NOT in the tree.
    expect(record.blobsCreated).toHaveLength(1)
    const paths = (record.treeEntriesPosted ?? []).map(e => e.path)
    expect(paths).toEqual(['Real note.md'])
    expect(paths).not.toContain('Untitled.canvas')

    expect(outcome.result.created).toBe(1)
    expect(outcome.result.deleted).toBe(0)
  })
})
