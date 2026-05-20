/**
 * githubSyncClassify.test.ts
 *
 * Tests the pullFromGitHub classifier — the heart of the sync orchestration.
 * Six branches to cover:
 *   - unchanged
 *   - remoteCreated
 *   - remoteUpdated
 *   - autoMerged (3-way merge succeeds)
 *   - conflict (3-way merge overlap)
 *   - conflictDeleted (local edited a note remote deleted)
 *   - remoteDeleted (local untouched, remote gone)
 *
 * Strategy: mock the github.ts API surface that pullFromGitHub calls
 * (getBranchRefSha, getCommitTreeSha, getTreeMap, getBlobContent,
 * gitBlobSha) so the orchestrator becomes pure. The threeWayMerge
 * util runs for real — it's already tested elsewhere.
 */

// ── idb-keyval mock (Zustand persist + attachments) ─────────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// ── github.ts mock — capture the call args so we can verify lazy-loads ──────
const mockGetBranchRefSha = jest.fn()
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()
const mockGitBlobSha = jest.fn()
// Push-side helpers — captured so the bulk-delete test can inspect args.
const mockCreateTree = jest.fn()
const mockCreateCommit = jest.fn()
const mockUpdateBranchRef = jest.fn()
const mockCreateBlob = jest.fn()

jest.mock('../utils/github', () => ({
  getBranchRefSha:    (...a: unknown[]) => mockGetBranchRefSha(...a),
  getCommitTreeSha:   (...a: unknown[]) => mockGetCommitTreeSha(...a),
  getTreeMap:         (...a: unknown[]) => mockGetTreeMap(...a),
  getBlobContent:     (...a: unknown[]) => mockGetBlobContent(...a),
  gitBlobSha:         (...a: unknown[]) => mockGitBlobSha(...a),
  gitBlobShaBytes:    jest.fn(),
  createTree:         (...a: unknown[]) => mockCreateTree(...a),
  createCommit:       (...a: unknown[]) => mockCreateCommit(...a),
  updateBranchRef:    (...a: unknown[]) => mockUpdateBranchRef(...a),
  createBlob:         (...a: unknown[]) => mockCreateBlob(...a),
  createBlobBinary:   jest.fn(),
  fetchZipball:       jest.fn(),
  blobToBase64:       jest.fn(),
}))

import { pullFromGitHub } from '../utils/githubSync'
import type { Note, Folder, SyncRepo } from '@/types'

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
  } as Note
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  mockGetCommitTreeSha.mockResolvedValue('treesha')
})

// ── unchanged ───────────────────────────────────────────────────────────────

test('classifies a stable local note with matching remote SHA as unchanged', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-foo']]))
  mockGitBlobSha.mockResolvedValue('sha-foo')

  const local: Note[] = [note({ id: '1', title: 'Foo', content: 'body', gitPath: 'Foo.md', gitLastPushedSha: 'sha-foo' })]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toEqual({ kind: 'unchanged', noteId: '1' })
  // unchanged path doesn't fetch the blob.
  expect(mockGetBlobContent).not.toHaveBeenCalled()
})

// ── remoteCreated ───────────────────────────────────────────────────────────

test('classifies a remote-only file (no local match) as remoteCreated', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Brand new.md', 'sha-new']]))
  mockGetBlobContent.mockResolvedValue('hello world')

  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: [], folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toMatchObject({
    kind: 'remoteCreated',
    path: 'Brand new.md',
    remoteSha: 'sha-new',
    remoteContent: 'hello world',
  })
})

// ── remoteUpdated ───────────────────────────────────────────────────────────

test('remote changed + local untouched = remoteUpdated', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-new']]))
  mockGitBlobSha.mockResolvedValue('sha-old')    // local content hashes to OLD
  mockGetBlobContent.mockResolvedValue('new body')

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: 'old body', gitPath: 'Foo.md', gitLastPushedSha: 'sha-old' }),
  ]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toMatchObject({
    kind: 'remoteUpdated',
    noteId: '1',
    remoteSha: 'sha-new',
    remoteContent: 'new body',
  })
})

// ── autoMerged ──────────────────────────────────────────────────────────────

test('non-overlapping local + remote edits auto-merge', async () => {
  // Layout:
  //   ancestor = "line1\nline2\nline3"
  //   local    = "line1 (local edit)\nline2\nline3"
  //   remote   = "line1\nline2\nline3 (remote edit)"
  // Different lines → threeWayMerge succeeds.
  const ancestor = 'line1\nline2\nline3'
  const localContent = 'line1 (local edit)\nline2\nline3'
  const remoteContent = 'line1\nline2\nline3 (remote edit)'

  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-remote']]))
  // gitBlobSha is called on local content; we just need a value that's NOT
  // equal to either lastPushed or remote so the orchestrator hits the
  // remoteChanged && localChanged branch.
  mockGitBlobSha.mockResolvedValue('sha-local')
  // First getBlobContent: remote content; second: ancestor (lastPushed).
  mockGetBlobContent
    .mockResolvedValueOnce(remoteContent) // remote (loadRemote)
    .mockResolvedValueOnce(ancestor)      // ancestor (lastPushed)

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: localContent, gitPath: 'Foo.md', gitLastPushedSha: 'sha-ancestor' }),
  ]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0].kind).toBe('autoMerged')
})

// ── conflict ────────────────────────────────────────────────────────────────

test('overlapping local + remote edits on the same line = conflict', async () => {
  const ancestor = 'shared line'
  const localContent = 'shared line — local change'
  const remoteContent = 'shared line — remote change'

  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')
  mockGetBlobContent
    .mockResolvedValueOnce(remoteContent)
    .mockResolvedValueOnce(ancestor)

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: localContent, gitPath: 'Foo.md', gitLastPushedSha: 'sha-ancestor' }),
  ]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toMatchObject({
    kind: 'conflict',
    noteId: '1',
    path: 'Foo.md',
    remoteSha: 'sha-remote',
  })
})

// ── conflict when ancestor is missing (lastPushed = null) ───────────────────

test('no lastPushed sha → falls through to conflict instead of crashing', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')
  mockGetBlobContent.mockResolvedValueOnce('remote body') // only the remote load

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: 'local body', gitPath: 'Foo.md', gitLastPushedSha: null }),
  ]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0].kind).toBe('conflict')
})

// ── remoteDeleted ───────────────────────────────────────────────────────────

test('local note with gitPath that disappeared remotely = remoteDeleted', async () => {
  mockGetTreeMap.mockResolvedValue(new Map())  // empty tree
  // Crucially: local SHA == lastPushedSha (no local edit) so the
  // disappearance is unambiguous → remoteDeleted, not conflictDeleted.
  mockGitBlobSha.mockResolvedValue('sha-clean')

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: 'body', gitPath: 'Foo.md', gitLastPushedSha: 'sha-clean', updatedAt: 0 }),
  ]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toMatchObject({ kind: 'remoteDeleted', noteId: '1' })
})

// ── conflictDeleted ─────────────────────────────────────────────────────────

test('remote deleted while local edited (sha drifted) = conflictDeleted', async () => {
  mockGetTreeMap.mockResolvedValue(new Map())  // empty remote
  mockGitBlobSha.mockResolvedValue('sha-local-edited')

  const local: Note[] = [
    note({
      id: '1', title: 'Foo',
      content: 'edited body',
      gitPath: 'Foo.md',
      gitLastPushedSha: 'sha-old',
    }),
  ]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0].kind).toBe('conflictDeleted')
})

// ── multiple files, mixed outcomes ──────────────────────────────────────────

test('mixed batch: unchanged + remoteCreated + remoteUpdated in one pull', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([
    ['Stable.md',  'sha-stable'],
    ['New.md',     'sha-new'],
    ['Drifted.md', 'sha-drifted-new'],
  ]))
  // gitBlobSha is called for each LOCAL note (Stable + Drifted).
  mockGitBlobSha.mockImplementation(async (content: string) => {
    if (content.includes('stable')) return 'sha-stable'
    if (content.includes('drifted')) return 'sha-drifted-old'
    return 'unknown'
  })
  mockGetBlobContent.mockImplementation(async (_t, _o, _n, sha: string) => {
    if (sha === 'sha-new') return 'new remote'
    if (sha === 'sha-drifted-new') return 'drifted remote'
    return 'unknown'
  })

  const local: Note[] = [
    note({ id: '1', title: 'Stable',  content: 'stable body',  gitPath: 'Stable.md',  gitLastPushedSha: 'sha-stable' }),
    note({ id: '2', title: 'Drifted', content: 'drifted body', gitPath: 'Drifted.md', gitLastPushedSha: 'sha-drifted-old' }),
  ]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  const kinds = classifications.map(c => c.kind).sort()
  expect(kinds).toEqual(['remoteCreated', 'remoteUpdated', 'unchanged'])
})

// ── End-to-end: bulk-delete then sync emits sha:null deletes for them ──────
//
// User flow we're locking in:
//   1. User soft-deletes ~hundreds of notes locally (Del key in tree).
//   2. User hits Sync.
//   3. pullFromGitHub sees each remote file still has a matching local
//      note (the soft-deleted one) — emits `unchanged`, no resurrection.
//   4. syncToGitHub then sees those notes have isDeleted=true and
//      gitPath set + matching remote tree entries — emits sha:null tree
//      entries to actually delete the files remotely.
// We verify #3+#4 here. The pull side is already covered by the
// "soft-deleted local note with matching gitPath" test above; this one
// drives the push payload.

import { syncToGitHub } from '../utils/githubSync'

test('bulk-delete + sync emits sha:null tree entries for every deleted note', async () => {
  // Two notes locally — both soft-deleted, both have a matching remote
  // tree entry.
  mockGetTreeMap.mockResolvedValue(new Map([
    ['Note A.md', 'sha-a'],
    ['Note B.md', 'sha-b'],
  ]))
  mockGitBlobSha.mockResolvedValue('any')
  // Capture the tree entries that get sent to createTree.
  mockCreateTree.mockResolvedValue('new-tree-sha')
  mockCreateCommit.mockResolvedValue({ sha: 'new-commit-sha', html_url: 'https://github.com/me/vault/commit/new-commit-sha' })
  mockUpdateBranchRef.mockResolvedValue(undefined)

  const local: Note[] = [
    note({ id: '1', title: 'Note A', content: 'a body', gitPath: 'Note A.md', gitLastPushedSha: 'sha-a', isDeleted: true }),
    note({ id: '2', title: 'Note B', content: 'b body', gitPath: 'Note B.md', gitLastPushedSha: 'sha-b', isDeleted: true }),
  ]

  const result = await syncToGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  // The push step emitted a tree with TWO sha:null deletions, no blob uploads.
  expect(mockCreateBlob).not.toHaveBeenCalled()
  expect(mockCreateTree).toHaveBeenCalledTimes(1)
  const entriesArg = mockCreateTree.mock.calls[0][4] as Array<{ path: string; sha: string | null }>
  const deletes = entriesArg.filter(e => e.sha === null)
  expect(deletes).toHaveLength(2)
  const deletedPaths = deletes.map(e => e.path).sort()
  expect(deletedPaths).toEqual(['Note A.md', 'Note B.md'])
  expect(result.result.deleted).toBe(2)
})

// ── skips non-.md paths ─────────────────────────────────────────────────────
//
// Regression: deleting a note locally then syncing used to undo the delete.
// The pull saw the remote file, no MATCHING (non-deleted) local note, and
// classified it as remoteCreated → apply added a new note → push then
// had nothing to delete. User saw their deletes silently re-imported.

test('soft-deleted local note with matching gitPath is NOT classified as remoteCreated', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Goodbye.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-anything')

  const local: Note[] = [
    note({
      id: '1', title: 'Goodbye',
      content: 'bye',
      gitPath: 'Goodbye.md',
      gitLastPushedSha: 'sha-remote',
      isDeleted: true,
    }),
  ]
  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

  // Classified as unchanged (no fetch, no apply churn). The push step's
  // delete-handling pass is what propagates the deletion to the remote.
  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toEqual({ kind: 'unchanged', noteId: '1' })
  // CRITICAL: no remote-blob fetch for files we're about to delete.
  expect(mockGetBlobContent).not.toHaveBeenCalled()
})

// ── skips non-.md paths ─────────────────────────────────────────────────────

test('non-.md entries route to separate kinds (attachments, folderCreated)', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([
    ['Note.md', 'sha-note'],
    ['attachments/image.png', 'sha-png'],
    ['.gitignore', 'sha-gitignore'],
  ]))
  mockGetBlobContent.mockResolvedValue('body')

  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: [], folders: [] })

  const kinds = classifications.map(c => c.kind).sort()
  expect(kinds).toContain('remoteCreated')
  expect(kinds).toContain('attachmentCreated')
  // The markdown classification for Note.md should be the only "note-shaped" one.
  const noteClassifications = classifications.filter(c => c.kind === 'remoteCreated')
  expect(noteClassifications).toHaveLength(1)
})
