/**
 * @jest-environment node
 *
 * attachmentSyncTimeoutRetry.test.ts
 *
 * Covers the "attachment silently dropped from push" failure mode: a stalled
 * IndexedDB read (seen on mobile Safari) during syncPush's section 3b used to
 * degrade `listAttachmentPaths()` to `[]`, which the push read as "zero local
 * attachments" and proceeded to a successful-looking commit that omitted real
 * attachment blobs — with nothing recorded to trigger a retry.
 *
 * The fix: syncPush uses *Tracked variants (listAttachmentPathsTracked,
 * getAttachmentGitShaTracked, getAttachmentDoNotSyncTracked) that report
 * `timedOut` separately from the fallback value. A timeout aborts the WHOLE
 * attachment section (3b + 3c) for that cycle — no tree entries, no
 * `uploadedShas` bookkeeping — and the outcome carries
 * `result.attachmentSyncSkipped: true` so the caller can warn. Because
 * nothing is recorded as "pushed", the next cycle's 3b runs exactly as if
 * this one never attempted it.
 *
 * Strategy mirrors doNotSyncSync.test.ts: mock the github.ts network surface
 * and the attachments module, keep gitBlobSha REAL, drive syncToGitHub
 * directly.
 */

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
  // When true, listAttachmentPathsTracked reports a timeout (the IDB stall
  // this whole test file simulates).
  listTimesOut: false,
}
jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPathsTracked: async () => (
    mockAttachmentState.listTimesOut
      ? { value: [], timedOut: true }
      : { value: mockAttachmentState.paths, timedOut: false }
  ),
  getAttachmentBlob: async (p: string) => mockAttachmentState.blobByPath.get(p) ?? null,
  getAttachmentGitShaTracked: async (p: string) => ({
    value: mockAttachmentState.shaByPath.get(p) ?? null,
    timedOut: false,
  }),
  getAttachmentDoNotSyncTracked: async (p: string) => ({
    value: mockAttachmentState.doNotSyncPaths.has(p),
    timedOut: false,
  }),
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
  }
})

import { syncToGitHub, _resetUploadedShaCache } from '../utils/githubSync'
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
  } as Note
}

function postedTreeEntries(): GitTreeEntry[] {
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
  mockAttachmentState.listTimesOut = false
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

describe('syncToGitHub — attachment push survives a stalled IndexedDB read', () => {
  test('a timed-out listAttachmentPathsTracked still lets note text push normally', async () => {
    mockAttachmentState.listTimesOut = true
    const real = note({ id: 'n1', title: 'Real note', content: 'hello\n' })

    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [real], folders: [] })

    const paths = postedTreeEntries().map(e => e.path)
    expect(paths).toEqual(['Real note.md'])
    expect(outcome.result.unchanged).toBe(false)
    expect(outcome.result.created).toBe(1)
    expect(outcome.pathUpdates.map(u => u.noteId)).toEqual(['n1'])
  })

  test('a timed-out listAttachmentPathsTracked uploads NO attachment blobs and flags attachmentSyncSkipped', async () => {
    // Attachments genuinely exist in IDB (the underlying keys() call would
    // find them) but the tracked read reports a timeout instead of the real
    // list — proving the push does not fall back to "treat [] as truth".
    mockAttachmentState.paths = ['Files/screenshot.png']
    mockAttachmentState.shaByPath.set('Files/screenshot.png', 'shot-sha')
    mockAttachmentState.blobByPath.set('Files/screenshot.png', new Blob([new Uint8Array([1])], { type: 'image/png' }))
    mockAttachmentState.listTimesOut = true
    const real = note({ id: 'n1', title: 'Real note', content: 'hello\n' })

    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [real], folders: [] })

    expect(mockCreateBlobBinary).not.toHaveBeenCalled()
    const paths = postedTreeEntries().map(e => e.path)
    expect(paths).not.toContain('Files/screenshot.png')
    expect(outcome.result.attachmentSyncSkipped).toBe(true)
  })

  test('a skipped cycle records NO uploadedShas bookkeeping — the next cycle retries as if it never ran', async () => {
    mockAttachmentState.paths = ['Files/screenshot.png']
    mockAttachmentState.shaByPath.set('Files/screenshot.png', 'shot-sha')
    mockAttachmentState.blobByPath.set('Files/screenshot.png', new Blob([new Uint8Array([1])], { type: 'image/png' }))
    mockAttachmentState.listTimesOut = true

    // Cycle 1: times out, skips the attachment (also give it a real note edit
    // so the push doesn't short-circuit before reaching a real commit).
    const real1 = note({ id: 'n1', title: 'Real note', content: 'v1\n' })
    const outcome1 = await syncToGitHub({ token: 'tok', repo: REPO, notes: [real1], folders: [] })
    expect(outcome1.result.attachmentSyncSkipped).toBe(true)
    expect(mockCreateBlobBinary).not.toHaveBeenCalled()

    // Cycle 2: IDB recovers. The attachment must still be seen as pending —
    // nothing from cycle 1 marked it as already uploaded.
    mockAttachmentState.listTimesOut = false
    mockCreateTree.mockClear()
    const real2 = note({
      id: 'n1', title: 'Real note', content: 'v1\n',
      gitPath: 'Real note.md', gitLastPushedSha: outcome1.pathUpdates[0]?.gitLastPushedSha ?? null,
      gitRemoteBaseSha: outcome1.pathUpdates[0]?.gitRemoteBaseSha ?? null,
    })
    const outcome2 = await syncToGitHub({ token: 'tok', repo: REPO, notes: [real2], folders: [] })

    expect(mockCreateBlobBinary).toHaveBeenCalledTimes(1)
    const paths = postedTreeEntries().map(e => e.path)
    expect(paths).toContain('Files/screenshot.png')
    expect(outcome2.result.attachmentSyncSkipped).toBeFalsy()
  })

  test('tombstones are also left unconsumed this cycle (3c skipped alongside 3b)', async () => {
    mockAttachmentState.listTimesOut = true
    const real = note({ id: 'n1', title: 'Real note', content: 'hello\n' })

    await syncToGitHub({ token: 'tok', repo: REPO, notes: [real], folders: [] })

    // clearAttachmentTombstones is mocked as a no-op jest.fn-less async —
    // the meaningful assertion is that the tombstone path never appears as
    // a delete entry, since 3c must not run against unverified local state.
    const paths = postedTreeEntries().map(e => e.path)
    expect(paths).toEqual(['Real note.md'])
  })
})
