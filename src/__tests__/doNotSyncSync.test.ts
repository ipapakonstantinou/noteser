/**
 * @jest-environment node
 *
 * doNotSyncSync.test.ts
 *
 * Sync-pipeline coverage for the do-not-sync flag (#179) — the fix for
 * "Feature-tour demo images get pushed into the real vault repo".
 *
 * Push side (syncToGitHub):
 *   1. A `doNotSync: true` note is never serialized into the push tree —
 *      no blob upload, no tree entry, no commit.
 *   2. A normal note alongside a flagged note still pushes normally.
 *   3. A soft-deleted flagged note emits NO `sha:null` delete for a legacy
 *      user's remote copy (remote cleanup is manual by design).
 *   4. Delete-safety-net: a soft-deleted UNFLAGGED duplicate sharing the
 *      live flagged note's gitPath must not sha:null the path the flagged
 *      note maps to.
 *   5. A flagged attachment record is skipped by the binary push; unflagged
 *      attachments still upload.
 *
 * Pull side (pullFromGitHub):
 *   6. A flagged note classifies `unchanged` even when the remote blob
 *      changed (no overwrite, no conflict tab, no blob fetch).
 *   7. A flagged note whose remote file was deleted manually is NOT
 *      classified remoteDeleted/conflictDeleted (no resurrect-the-trash).
 *   8. A remote file at the flagged note's computed path is NOT adopted —
 *      it classifies remoteCreated (materialises as a separate note).
 *
 * Strategy mirrors progressiveClone.test.ts: mock the github.ts network
 * surface, keep gitBlobSha REAL, drive the orchestrators directly.
 */

// ── idb-keyval mock (Zustand persist + snapshot cache) ──────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// ── attachments mock — controllable per test ────────────────────────────────
const mockAttachmentState = {
  paths: [] as string[],
  shaByPath: new Map<string, string>(),
  doNotSyncPaths: new Set<string>(),
  blobByPath: new Map<string, Blob>(),
}
jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => mockAttachmentState.paths,
  getAttachmentBlob: async (p: string) => mockAttachmentState.blobByPath.get(p) ?? null,
  getAttachmentGitSha: async (p: string) => mockAttachmentState.shaByPath.get(p) ?? null,
  getAttachmentDoNotSync: async (p: string) => mockAttachmentState.doNotSyncPaths.has(p),
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
  putAttachmentAtPath: async () => undefined,
}))

import { webcrypto } from 'node:crypto'
import { TextEncoder, TextDecoder } from 'node:util'

const g = globalThis as unknown as {
  crypto?: Crypto
  TextEncoder?: typeof TextEncoder
  TextDecoder?: typeof TextDecoder
}
if (typeof g.crypto === 'undefined' || !g.crypto.subtle) g.crypto = webcrypto as unknown as Crypto
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = TextEncoder
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoder

// ── github.ts mock — gitBlobSha/Bytes stay REAL via requireActual ───────────
const mockGetBranchRefSha = jest.fn()
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()
const mockCreateTree = jest.fn()
const mockCreateCommit = jest.fn()
const mockUpdateBranchRef = jest.fn()
const mockCreateBlob = jest.fn()
const mockCreateBlobBinary = jest.fn()

jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github')
  return {
    ...actual,
    getBranchRefSha:  (...a: unknown[]) => mockGetBranchRefSha(...a),
    getCommitTreeSha: (...a: unknown[]) => mockGetCommitTreeSha(...a),
    getTreeMap:       (...a: unknown[]) => mockGetTreeMap(...a),
    getBlobContent:   (...a: unknown[]) => mockGetBlobContent(...a),
    createTree:       (...a: unknown[]) => mockCreateTree(...a),
    createCommit:     (...a: unknown[]) => mockCreateCommit(...a),
    updateBranchRef:  (...a: unknown[]) => mockUpdateBranchRef(...a),
    createBlob:       (...a: unknown[]) => mockCreateBlob(...a),
    createBlobBinary: (...a: unknown[]) => mockCreateBlobBinary(...a),
    // gitBlobSha + gitBlobShaBytes come through REAL via spread.
  }
})

import { pullFromGitHub, syncToGitHub, _resetUploadedShaCache } from '../utils/githubSync'
import type { Note, SyncRepo } from '@/types'
import type { GitTreeEntry } from '../utils/github'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: true }

function note(input: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: input.id,
    title: input.title,
    content: input.content ?? '',
    folderId: input.folderId ?? null,
    createdAt: 0,
    updatedAt: input.updatedAt ?? 0,
    isDeleted: input.isDeleted ?? false,
    deletedAt: input.isDeleted ? 1 : null,
    isPinned: false,
    templateId: null,
    gitPath: input.gitPath ?? null,
    gitLastPushedSha: input.gitLastPushedSha ?? null,
    gitRemoteBaseSha: input.gitRemoteBaseSha ?? null,
    kind: 'markdown',
    doNotSync: input.doNotSync,
  } as Note
}

function postedTreeEntries(): GitTreeEntry[] {
  // createTree(token, owner, name, baseTreeSha, entries)
  expect(mockCreateTree).toHaveBeenCalledTimes(1)
  return mockCreateTree.mock.calls[0][4] as GitTreeEntry[]
}

beforeEach(async () => {
  jest.clearAllMocks()
  _resetUploadedShaCache()
  mockAttachmentState.paths = []
  mockAttachmentState.shaByPath.clear()
  mockAttachmentState.doNotSyncPaths.clear()
  mockAttachmentState.blobByPath.clear()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  mockGetCommitTreeSha.mockResolvedValue('treesha')
  mockGetTreeMap.mockResolvedValue(new Map())
  mockCreateBlob.mockResolvedValue('server-blob-sha')
  mockCreateBlobBinary.mockResolvedValue('server-bin-sha')
  mockCreateTree.mockResolvedValue('new-tree')
  mockCreateCommit.mockResolvedValue({ sha: 'new-commit', html_url: 'https://github.com/x' })
  mockUpdateBranchRef.mockResolvedValue(undefined)
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: '', vaultEncryptionEnabled: false })
})

// ── Push ─────────────────────────────────────────────────────────────────────

describe('syncToGitHub — doNotSync notes never enter the push tree', () => {
  test('a flagged note is never serialized: no blob, no tree, no commit', async () => {
    const tour = note({ id: 't1', title: 'Feature tour', content: 'demo body\n', doNotSync: true })

    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [tour], folders: [] })

    expect(mockCreateBlob).not.toHaveBeenCalled()
    expect(mockCreateTree).not.toHaveBeenCalled()
    expect(mockCreateCommit).not.toHaveBeenCalled()
    expect(mockUpdateBranchRef).not.toHaveBeenCalled()
    expect(outcome.result.unchanged).toBe(true)
    expect(outcome.result.created).toBe(0)
    expect(outcome.pathUpdates).toEqual([])
  })

  test('a normal note alongside a flagged note still pushes — only the normal path lands in the tree', async () => {
    const tour = note({ id: 't1', title: 'Feature tour', content: 'demo body\n', doNotSync: true })
    const real = note({ id: 'n1', title: 'Real note', content: 'hello\n' })

    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [tour, real], folders: [] })

    const paths = postedTreeEntries().map(e => e.path)
    expect(paths).toEqual(['Real note.md'])
    expect(paths).not.toContain('Feature tour.md')
    expect(outcome.result.created).toBe(1)
    expect(outcome.result.deleted).toBe(0)
    // Only the real note gets path bookkeeping — the flagged note's git
    // fields are left untouched.
    expect(outcome.pathUpdates.map(u => u.noteId)).toEqual(['n1'])
  })

  test('a soft-deleted flagged note emits NO sha:null delete for a legacy remote copy', async () => {
    // Legacy user: the tour note was pushed before the flag existed, so the
    // remote holds Feature tour.md. The user trashes it locally — the remote
    // file must stay (we never auto-delete remote files for flagged items).
    const tour = note({
      id: 't1', title: 'Feature tour', content: 'demo body\n',
      doNotSync: true, isDeleted: true,
      gitPath: 'Feature tour.md', gitLastPushedSha: 'legacy-sha', gitRemoteBaseSha: 'legacy-sha',
    })
    mockGetTreeMap.mockResolvedValue(new Map([['Feature tour.md', 'legacy-sha']]))

    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [tour], folders: [] })

    expect(mockCreateTree).not.toHaveBeenCalled()
    expect(mockCreateCommit).not.toHaveBeenCalled()
    expect(outcome.result.deleted).toBe(0)
    // The skip also leaves the note's git fields alone (no clearing update),
    // so a restore from trash keeps the legacy linkage intact.
    expect(outcome.pathUpdates).toEqual([])
  })

  test('safety net: a soft-deleted UNFLAGGED duplicate sharing the flagged live note gitPath does not sha:null it', async () => {
    // The tour seeder soft-deletes duplicate tour notes. A duplicate that
    // carries the same gitPath as the live flagged note must not delete the
    // remote file the live note maps to — the flagged note's paths are part
    // of protectedRemotePaths even though it never pushes.
    const live = note({
      id: 'live', title: 'Feature tour', content: 'demo body\n',
      doNotSync: true, gitPath: 'Feature tour.md',
      gitLastPushedSha: 'legacy-sha', gitRemoteBaseSha: 'legacy-sha',
    })
    const dup = note({
      id: 'dup', title: 'Feature tour', content: 'old dup body\n',
      isDeleted: true, gitPath: 'Feature tour.md',
      gitLastPushedSha: 'dup-sha', gitRemoteBaseSha: 'dup-sha',
    })
    mockGetTreeMap.mockResolvedValue(new Map([['Feature tour.md', 'legacy-sha']]))

    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [live, dup], folders: [] })

    // No delete entry — no tree change at all.
    expect(mockCreateTree).not.toHaveBeenCalled()
    expect(outcome.result.deleted).toBe(0)
    // The duplicate still gets its git fields cleared (it is gone locally),
    // but the remote file survives.
    expect(outcome.pathUpdates).toEqual([
      { noteId: 'dup', gitPath: null, gitLastPushedSha: null, gitRemoteBaseSha: null },
    ])
  })

  test('a flagged attachment is skipped by the binary push; unflagged attachments still upload', async () => {
    mockAttachmentState.paths = ['Files/feature-tour/00-welcome.png', 'Files/mine.png']
    mockAttachmentState.shaByPath.set('Files/feature-tour/00-welcome.png', 'tour-sha')
    mockAttachmentState.shaByPath.set('Files/mine.png', 'mine-sha')
    mockAttachmentState.doNotSyncPaths.add('Files/feature-tour/00-welcome.png')
    mockAttachmentState.blobByPath.set('Files/feature-tour/00-welcome.png', new Blob([new Uint8Array([1])], { type: 'image/png' }))
    mockAttachmentState.blobByPath.set('Files/mine.png', new Blob([new Uint8Array([2])], { type: 'image/png' }))

    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [], folders: [] })

    // Exactly one binary upload — the user's own attachment.
    expect(mockCreateBlobBinary).toHaveBeenCalledTimes(1)
    const paths = postedTreeEntries().map(e => e.path)
    expect(paths).toEqual(['Files/mine.png'])
    expect(paths).not.toContain('Files/feature-tour/00-welcome.png')
    expect(outcome.result.created).toBe(1)
  })
})

// ── Pull ─────────────────────────────────────────────────────────────────────

describe('pullFromGitHub — doNotSync notes are invisible to the classifier', () => {
  test('a flagged note classifies unchanged even when the remote blob changed (no fetch, no conflict)', async () => {
    mockGetTreeMap.mockResolvedValue(new Map([['Feature tour.md', 'remote-changed-sha']]))
    const tour = note({
      id: 't1', title: 'Feature tour', content: 'locally edited demo body\n',
      doNotSync: true, gitPath: 'Feature tour.md',
      gitLastPushedSha: 'old-sha', gitRemoteBaseSha: 'old-sha',
    })

    const { classifications } = await pullFromGitHub({ token: 'tok', repo: REPO, notes: [tour], folders: [] })

    expect(classifications).toEqual([{ kind: 'unchanged', noteId: 't1' }])
    expect(mockGetBlobContent).not.toHaveBeenCalled()
  })

  test('a flagged note whose remote file is gone is NOT classified remoteDeleted/conflictDeleted', async () => {
    // Legacy user deleted Feature tour.md from the repo manually — the local
    // flagged note must survive (and push will not re-create the file).
    mockGetTreeMap.mockResolvedValue(new Map())
    const tour = note({
      id: 't1', title: 'Feature tour', content: 'demo body\n',
      doNotSync: true, gitPath: 'Feature tour.md',
      gitLastPushedSha: 'legacy-sha', gitRemoteBaseSha: 'legacy-sha',
    })

    const { classifications } = await pullFromGitHub({ token: 'tok', repo: REPO, notes: [tour], folders: [] })

    expect(classifications).toEqual([])
  })

  test('a remote file at the flagged note computed path is NOT adopted — classifies remoteCreated', async () => {
    // The user has their OWN `Feature tour.md` in the repo while the local
    // flagged seed (no gitPath) sits at the same computed path. Adoption
    // would drag the flagged note into sync — instead the remote file must
    // materialise as a separate local note.
    mockGetTreeMap.mockResolvedValue(new Map([['Feature tour.md', 'user-sha']]))
    mockGetBlobContent.mockResolvedValue('my own tour notes\n')
    const tour = note({ id: 't1', title: 'Feature tour', content: 'demo body\n', doNotSync: true })

    const { classifications } = await pullFromGitHub({ token: 'tok', repo: REPO, notes: [tour], folders: [] })

    expect(classifications).toHaveLength(1)
    expect(classifications[0]).toMatchObject({
      kind: 'remoteCreated',
      path: 'Feature tour.md',
      remoteSha: 'user-sha',
      remoteContent: 'my own tour notes\n',
    })
  })
})
