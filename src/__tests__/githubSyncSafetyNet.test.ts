/**
 * @jest-environment node
 *
 * githubSyncSafetyNet.test.ts
 *
 * rename-not-delete GUARD 2 — the HARD push-side safety net. Focused unit
 * tests that drive the REAL syncToGitHub against a mocked github.ts network
 * surface (reads + push mutators stubbed, gitBlobSha REAL) and assert that a
 * `sha:null` DELETE is NEVER emitted for a remote path that a LIVE note still
 * represents — even when an upstream classification was wrong and soft-deleted
 * the note.
 *
 * The data-loss bug: a rename gets misread as "old-path deleted + new-path
 * created", soft-deleting the original note while it keeps its (old) gitPath.
 * The push deletion loop then emits `sha:null` for that gitPath because it is
 * still in the remote tree → the user's REAL file is destroyed. The safety net
 * must refuse the delete whenever a live note maps to that path (by current
 * path OR by content hash).
 */

// idb-keyval — in-memory store for Zustand persist + attachments.
jest.mock('idb-keyval', () => {
  const store = new Map<IDBValidKey, unknown>()
  return {
    get: jest.fn(async (k: IDBValidKey) => store.get(k)),
    set: jest.fn(async (k: IDBValidKey, v: unknown) => { store.set(k, v) }),
    del: jest.fn(async (k: IDBValidKey) => { store.delete(k) }),
    keys: jest.fn(async () => Array.from(store.keys())),
    clear: jest.fn(async () => { store.clear() }),
  }
})

// No binary attachments in these tests.
jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
  putAttachmentAtPath: async () => undefined,
}))

// github.ts: stub the network surface (reads + push mutators), keep hashing REAL.
const mockGetBranchRefSha = jest.fn()
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()
const mockCreateBlob = jest.fn()
const mockCreateTree = jest.fn()
const mockCreateCommit = jest.fn()
const mockUpdateBranchRef = jest.fn()

// Capture the tree entries syncToGitHub builds so we can inspect for sha:null
// deletes directly (the most precise assertion).
let lastTreeEntries: Array<{ path: string; sha: string | null }> = []

jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github')
  return {
    ...actual,
    getBranchRefSha: (...a: unknown[]) => mockGetBranchRefSha(...a),
    getCommitTreeSha: (...a: unknown[]) => mockGetCommitTreeSha(...a),
    getTreeMap: (...a: unknown[]) => mockGetTreeMap(...a),
    getBlobContent: (...a: unknown[]) => mockGetBlobContent(...a),
    createBlob: (...a: unknown[]) => mockCreateBlob(...a),
    createTree: (...a: unknown[]) => mockCreateTree(...a),
    createCommit: (...a: unknown[]) => mockCreateCommit(...a),
    updateBranchRef: (...a: unknown[]) => mockUpdateBranchRef(...a),
  }
})

import { syncToGitHub, serializeNote, _resetUploadedShaCache } from '../utils/githubSync'
import { gitBlobSha } from '../utils/github'
import type { Note, SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }

function makeNote(id: string, title: string, content: string, opts: Partial<Note> = {}): Note {
  return {
    id, title, content, folderId: null,
    createdAt: 1, updatedAt: 1, isDeleted: false, deletedAt: null,
    isPinned: false, templateId: null,
    gitPath: null, gitLastPushedSha: null, gitRemoteBaseSha: null,
    ...opts,
  }
}

beforeEach(async () => {
  jest.clearAllMocks()
  _resetUploadedShaCache()
  lastTreeEntries = []
  mockGetBranchRefSha.mockResolvedValue('parentcommit')
  mockGetCommitTreeSha.mockResolvedValue('basetree')
  mockCreateBlob.mockResolvedValue('newblobsha')
  // Record the entries, and return a DIFFERENT tree sha so a commit would be
  // attempted if (and only if) the push produced real changes.
  mockCreateTree.mockImplementation(async (_t, _o, _n, _base, entries) => {
    lastTreeEntries = entries as Array<{ path: string; sha: string | null }>
    return 'newtree'
  })
  mockCreateCommit.mockResolvedValue({ sha: 'commitsha', html_url: 'http://x' })
  mockUpdateBranchRef.mockResolvedValue(undefined)
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: '', vaultEncryptionEnabled: false })
})

// GUARD 2: a soft-deleted note whose gitPath an ACTIVE note ALSO maps to (by
// current path) must NOT be deleted.
test('safety net: soft-deleted note does NOT delete a path an active note currently maps to', async () => {
  const body = 'live content\n'
  const sha = await gitBlobSha(serializeNote({ content: body } as Note))

  const live = makeNote('live', 'Doc', body, {
    gitPath: 'Doc.md', gitLastPushedSha: sha, gitRemoteBaseSha: sha,
  })
  // Ghost: soft-deleted, but STILL carries gitPath 'Doc.md' — the active note
  // maps there now (same path), so the delete must be refused.
  const ghost = makeNote('ghost', 'Doc', body, {
    isDeleted: true, deletedAt: 2, gitPath: 'Doc.md',
    gitLastPushedSha: sha, gitRemoteBaseSha: sha,
  })

  // Remote tree has Doc.md at the live note's content sha → no real change.
  mockGetTreeMap.mockResolvedValue(new Map([['Doc.md', sha]]))

  const out = await syncToGitHub({ token: 't', repo: REPO, notes: [live, ghost], folders: [] })

  // No deletion emitted, and no sha:null entry for Doc.md.
  expect(out.result.deleted).toBe(0)
  expect(lastTreeEntries.find(e => e.path === 'Doc.md' && e.sha === null)).toBeUndefined()
})

// GUARD 2: a soft-deleted note whose gitPath differs in FORM from a live note's
// CURRENT path, but whose CONTENT a live note still equals, must NOT be deleted.
// This is the exact rename catastrophe: the live note moved to the space-form
// path, the ghost kept the dash-form gitPath, and the dash-form file is still
// in the remote tree. The content hash is what protects it.
test('safety net: soft-deleted note does NOT delete a path a live note represents by CONTENT (form differs)', async () => {
  const body = 'renamed content survives\n'
  const sha = await gitBlobSha(serializeNote({ content: body } as Note))

  // Live note now lives at the space-form path 'my note.md'.
  const live = makeNote('live', 'my note', body, {
    gitPath: 'my note.md', gitLastPushedSha: sha, gitRemoteBaseSha: sha,
  })
  // Ghost: soft-deleted, kept the dash-form gitPath 'my-note.md'.
  const ghost = makeNote('ghost', 'my-note', body, {
    isDeleted: true, deletedAt: 2, gitPath: 'my-note.md',
    gitLastPushedSha: sha, gitRemoteBaseSha: sha,
  })

  // Remote tree STILL has BOTH paths at the same content sha (the dash-form
  // file lingers — that's the file the buggy push would have deleted).
  mockGetTreeMap.mockResolvedValue(new Map([
    ['my note.md', sha],
    ['my-note.md', sha],
  ]))

  const out = await syncToGitHub({ token: 't', repo: REPO, notes: [live, ghost], folders: [] })

  // The dash-form path is protected by the live note's CONTENT hash → no delete.
  expect(lastTreeEntries.find(e => e.path === 'my-note.md' && e.sha === null)).toBeUndefined()
  expect(out.result.deleted).toBe(0)
})

// CONTROL: a genuinely orphaned remote file (NO live note maps to it, by path
// OR content) IS still deleted — the safety net must not block legitimate
// deletions. The ghost's content is unique and no active note represents it.
test('control: a genuinely orphaned soft-deleted note IS still deleted', async () => {
  const liveBody = 'live body\n'
  const liveSha = await gitBlobSha(serializeNote({ content: liveBody } as Note))
  const goneBody = 'this content is truly gone\n'
  const goneSha = await gitBlobSha(serializeNote({ content: goneBody } as Note))

  const live = makeNote('live', 'Keep', liveBody, {
    gitPath: 'Keep.md', gitLastPushedSha: liveSha, gitRemoteBaseSha: liveSha,
  })
  const ghost = makeNote('ghost', 'Gone', goneBody, {
    isDeleted: true, deletedAt: 2, gitPath: 'Gone.md',
    gitLastPushedSha: goneSha, gitRemoteBaseSha: goneSha,
  })

  mockGetTreeMap.mockResolvedValue(new Map([
    ['Keep.md', liveSha],
    ['Gone.md', goneSha],
  ]))

  const out = await syncToGitHub({ token: 't', repo: REPO, notes: [live, ghost], folders: [] })

  // Gone.md is not represented by any live note → it IS deleted.
  expect(lastTreeEntries.find(e => e.path === 'Gone.md' && e.sha === null)).toBeDefined()
  expect(out.result.deleted).toBe(1)
})
