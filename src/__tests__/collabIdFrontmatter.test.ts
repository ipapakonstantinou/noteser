/**
 * @jest-environment node
 *
 * collabIdFrontmatter.test.ts
 *
 * Feature B (vault-synced collabId) sync-safety guards:
 *
 *   1. serializeNote emits a `collabId:` frontmatter block ONLY for notes that
 *      carry one, and parseNote reads it back — a lossless round-trip with and
 *      without tags also present.
 *   2. A note that differs ONLY by gaining a collabId classifies as a clean
 *      `remoteUpdated`, never a `conflict` — and after apply a re-pull settles
 *      to `unchanged` (no churn).
 *   3. Remote collabId convergence: when local + remote hold DIFFERENT room ids
 *      but identical bodies, the repo's id wins without a content conflict.
 *
 * Strategy mirrors githubSyncRoundtrip.test.ts: node env (real crypto.subtle),
 * REAL gitBlobSha / serializeNote, only the github.ts network surface mocked.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
  listAttachmentPathsTracked: async () => ({ value: [], timedOut: false }),
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
  putAttachmentAtPath: async () => undefined,
}))

const mockGetBranchRefSha = jest.fn()
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()

jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github')
  return {
    ...actual,
    getBranchRefSha: (...a: unknown[]) => mockGetBranchRefSha(...a),
    getCommitTreeSha: (...a: unknown[]) => mockGetCommitTreeSha(...a),
    getTreeMap: (...a: unknown[]) => mockGetTreeMap(...a),
    getBlobContent: (...a: unknown[]) => mockGetBlobContent(...a),
    // gitBlobSha stays REAL.
  }
})

import { pullFromGitHub, serializeNote, parseNote } from '../utils/githubSync'
import { applyNonConflicts } from '../utils/syncApply'
import { gitBlobSha } from '../utils/github'
import { useNoteStore } from '../stores/noteStore'
import type { Note, SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }

beforeEach(async () => {
  jest.clearAllMocks()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  mockGetCommitTreeSha.mockResolvedValue('treesha')
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: '' })
})

// ── 1. serialize/parse round-trip ───────────────────────────────────────────

describe('serializeNote / parseNote collabId round-trip', () => {
  test('a note WITHOUT a collabId serializes body-only (no frontmatter)', () => {
    const out = serializeNote({ content: 'Hello world' } as Note)
    expect(out).toBe('Hello world\n')
    expect(out.startsWith('---')).toBe(false)
  })

  test('a note WITH a collabId emits a collabId frontmatter block (no blank line)', () => {
    const out = serializeNote({ content: 'Hello world', collabId: 'room-1' } as Note)
    expect(out).toBe('---\ncollabId: room-1\n---\nHello world\n')
    const parsed = parseNote(out)
    expect(parsed.collabId).toBe('room-1')
    expect(parsed.body).toBe('Hello world\n')
    expect(parsed.tags).toEqual([])
  })

  test('round-trip is lossless: re-serializing the parsed body reproduces identical bytes', () => {
    const original = serializeNote({ content: 'A\nB\nC', collabId: 'abc-123' } as Note)
    const parsed = parseNote(original)
    const reserialized = serializeNote({ content: parsed.body, collabId: parsed.collabId } as Note)
    expect(reserialized).toBe(original)
  })

  test('collabId coexists with a tags frontmatter line (Obsidian-authored file)', () => {
    const raw = '---\ncollabId: room-7\ntags: [alpha, "beta gamma"]\n---\nBody text\n'
    const parsed = parseNote(raw)
    expect(parsed.collabId).toBe('room-7')
    expect(parsed.tags).toEqual(['alpha', 'beta gamma'])
    expect(parsed.body).toBe('Body text\n')
  })

  test('an empty-body collab note round-trips', () => {
    const out = serializeNote({ content: '', collabId: 'room-9' } as Note)
    expect(out).toBe('---\ncollabId: room-9\n---\n')
    expect(parseNote(out).collabId).toBe('room-9')
    expect(parseNote(out).body).toBe('')
  })
})

// ── 2. gaining a collabId is a clean update, not a conflict ──────────────────

test('a note that differs ONLY by gaining a collabId classifies as remoteUpdated (not conflict) and re-pulls unchanged', async () => {
  // Seed a synced body-only note (no collabId).
  const rawOriginal = 'Hello\n'
  const originalSha = await gitBlobSha(rawOriginal)
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', originalSha]]))
  mockGetBlobContent.mockResolvedValue(rawOriginal)
  const first = await pullFromGitHub({ token: 't', repo: REPO, notes: [], folders: [] })
  await applyNonConflicts(first.classifications)
  const noteId = useNoteStore.getState().notes[0].id
  expect(useNoteStore.getState().notes[0].collabId).toBeUndefined()

  // Remote gains a collabId frontmatter (a collaborator shared + pushed it).
  const rawWithCollab = '---\ncollabId: shared-room\n---\nHello\n'
  const collabSha = await gitBlobSha(rawWithCollab)
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', collabSha]]))
  mockGetBlobContent.mockImplementation(async (_t, _o, _n, sha: string) =>
    sha === collabSha ? rawWithCollab : rawOriginal,
  )

  const second = await pullFromGitHub({
    token: 't', repo: REPO, notes: useNoteStore.getState().notes, folders: [],
  })
  expect(second.classifications).toHaveLength(1)
  expect(second.classifications[0]).toMatchObject({
    kind: 'remoteUpdated', noteId, collabId: 'shared-room',
  })

  // Apply → the note adopts the room id, body stays clean (no frontmatter leak).
  await applyNonConflicts(second.classifications)
  const after = useNoteStore.getState().notes[0]
  expect(after.collabId).toBe('shared-room')
  expect(after.content).toBe('Hello\n')

  // Third pull: nothing changed → unchanged (round-trip lossless, no churn).
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', collabSha]]))
  mockGetBlobContent.mockResolvedValue(rawWithCollab)
  const third = await pullFromGitHub({
    token: 't', repo: REPO, notes: useNoteStore.getState().notes, folders: [],
  })
  expect(third.classifications).toEqual([{ kind: 'unchanged', noteId }])
})

// ── 3. remote collabId convergence (different ids, same body) ────────────────

test('when local and remote hold DIFFERENT collabIds but identical bodies, the remote id wins without a conflict', async () => {
  // Seed a synced body-only note, then mint a LOCAL collabId that was never
  // pushed (so localChanged will be true on the next pull).
  const rawOriginal = 'Same body\n'
  const originalSha = await gitBlobSha(rawOriginal)
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', originalSha]]))
  mockGetBlobContent.mockResolvedValue(rawOriginal)
  const first = await pullFromGitHub({ token: 't', repo: REPO, notes: [], folders: [] })
  await applyNonConflicts(first.classifications)
  const noteId = useNoteStore.getState().notes[0].id
  const localRoom = useNoteStore.getState().ensureCollabId(noteId)
  expect(localRoom).toBeTruthy()

  // Remote independently gained a DIFFERENT collabId (same body).
  const rawRemote = '---\ncollabId: remote-room\n---\nSame body\n'
  const remoteSha = await gitBlobSha(rawRemote)
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', remoteSha]]))
  mockGetBlobContent.mockImplementation(async (_t, _o, _n, sha: string) =>
    sha === remoteSha ? rawRemote : rawOriginal,
  )

  const second = await pullFromGitHub({
    token: 't', repo: REPO, notes: useNoteStore.getState().notes, folders: [],
  })
  // Bodies match, only the metadata differs → clean remoteUpdated, NOT conflict.
  expect(second.classifications).toHaveLength(1)
  expect(second.classifications[0]).toMatchObject({
    kind: 'remoteUpdated', noteId, collabId: 'remote-room',
  })

  await applyNonConflicts(second.classifications)
  // Repo's id wins so collaborators converge.
  expect(useNoteStore.getState().notes[0].collabId).toBe('remote-room')
  expect(useNoteStore.getState().notes[0].content).toBe('Same body\n')
})
