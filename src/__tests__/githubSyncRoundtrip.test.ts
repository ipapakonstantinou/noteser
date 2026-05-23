/**
 * @jest-environment node
 *
 * githubSyncRoundtrip.test.ts
 *
 * REAL-hash round-trip tests for the pull → apply → re-pull cycle.
 *
 * Unlike githubSyncClassify.test.ts, these tests do NOT mock gitBlobSha.
 * They run the genuine serialize → SHA-1 → compare path so we exercise
 * the invariant the classifier actually depends on: the bytes named by
 * gitLastPushedSha must be reproducible from the note we stored.
 *
 * This is the regression guard for the "transformed-content vs raw-remote-SHA"
 * data-integrity bug: a remote `.md` that arrives WITH frontmatter is stored
 * locally with the frontmatter stripped and its tags re-prepended inline. The
 * stored note therefore serializes to DIFFERENT bytes than the raw remote file,
 * so pinning gitLastPushedSha to the raw remote blob SHA makes:
 *   (a) an untouched in-sync note look permanently `localChanged` (never
 *       `unchanged`), and
 *   (b) the three-way merge base mismatch local lineage, so genuine conflicts
 *       can silently auto-merge.
 *
 * Strategy: node test env (real crypto.subtle), mock ONLY the github.ts
 * network surface (ref/tree/blob fetch + the push mutators) but keep the
 * real gitBlobSha / gitBlobShaBytes. The note + folder stores and attachments
 * are mocked / driven directly so applyNonConflicts can write into a real
 * useNoteStore.
 */

// ── idb-keyval mock (Zustand persist + attachments) ─────────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// Attachments: no binary files in these tests.
jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
  putAttachmentAtPath: async () => undefined,
}))

// ── github.ts mock — network funcs mocked, hashing REAL ─────────────────────
// We pull the genuine gitBlobSha / gitBlobShaBytes through requireActual so the
// serialize → hash → compare round-trip runs for real. Only the network calls
// are stubbed.
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
    // gitBlobSha / gitBlobShaBytes stay REAL (spread from actual).
  }
})

import { pullFromGitHub } from '../utils/githubSync'
import { applyNonConflicts } from '../utils/syncApply'
import { gitBlobSha } from '../utils/github'
import { useNoteStore } from '../stores/noteStore'
import type { SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }

beforeEach(async () => {
  jest.clearAllMocks()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  mockGetCommitTreeSha.mockResolvedValue('treesha')
  // Fresh note store each test.
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  // Reset the per-device gitignore overlay so a stray setting can't leak.
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: '' })
})

// ── (a) Round-trip: apply a frontmatter note → re-pull must be `unchanged` ──
//
// A remote `.md` arrives WITH YAML frontmatter carrying tags. apply stores it
// with the frontmatter stripped + tags inlined. On the NEXT pull (same remote
// tree, nothing changed on either side) the note MUST classify `unchanged`.
//
// Pre-fix this FAILS: gitLastPushedSha is pinned to the raw remote SHA, but the
// stored note serializes to the transformed body whose SHA differs — so the
// classifier sees localChanged=true and the note never settles.
test('REPRO (a): pulled frontmatter note round-trips to `unchanged` on the next pull', async () => {
  const rawRemote = '---\ntags: [alpha]\n---\n\nHello world\n'
  const remoteSha = await gitBlobSha(rawRemote)

  // First pull: remote has the file, no local note yet → remoteCreated.
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', remoteSha]]))
  mockGetBlobContent.mockResolvedValue(rawRemote)

  const first = await pullFromGitHub({ token: 't', repo: REPO, notes: [], folders: [] })
  const created = first.classifications.find(c => c.kind === 'remoteCreated')
  expect(created).toBeDefined()

  // Apply it into the real note store.
  await applyNonConflicts(first.classifications)
  const stored = useNoteStore.getState().notes
  expect(stored).toHaveLength(1)
  // Sanity: the stored content is the TRANSFORMED body (frontmatter stripped,
  // tag re-prepended inline) — this is what creates the SHA mismatch. parseNote
  // keeps the blank line that followed the closing `---`, so the body is
  // "\nHello world\n" and the inlined form prepends "#alpha\n\n".
  expect(stored[0].content).toBe('#alpha\n\n\nHello world\n')

  // Second pull: same remote tree, nothing touched on either side.
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', remoteSha]]))
  mockGetBlobContent.mockResolvedValue(rawRemote)

  const second = await pullFromGitHub({
    token: 't', repo: REPO,
    notes: useNoteStore.getState().notes,
    folders: [],
  })

  expect(second.classifications).toHaveLength(1)
  expect(second.classifications[0]).toEqual({ kind: 'unchanged', noteId: stored[0].id })
})

// ── (b) Untouched local must NOT be dragged into a 3-way merge ──────────────
//
// This pins consequence #2 of the bug: because gitLastPushedSha is pinned to
// the RAW remote blob SHA (with frontmatter) while the stored note serializes
// to the TRANSFORMED body (no frontmatter), the classifier computes
// `localChanged = true` even for a note the user never touched. A pull where
// ONLY the remote changed therefore falls into the `remoteChanged &&
// localChanged` branch and runs threeWayMerge against a base (the raw remote
// file) that does NOT match the local lineage.
//
// The correct classification for "user never edited it, remote did" is a clean
// `remoteUpdated` (take remote). Pre-fix it is wrongly routed through the merge
// path — surfacing as `autoMerged` (silent) or `conflict` (false alarm),
// depending on what the remote touched. Either is wrong: an untouched note must
// never reach the merge machinery.
//
// Here the remote edits the FRONTMATTER tags only (alpha → alpha, beta). Local
// is byte-for-byte the pulled note. Pre-fix: the wrong base makes this a
// `conflict`. Post-fix: `remoteUpdated`.
test('REPRO (b): untouched local + remote-only edit must be `remoteUpdated`, never merged/conflicted', async () => {
  // Original remote the note was created from.
  const rawOriginal = '---\ntags: [alpha]\n---\n\nLine A\nLine B\nLine C\n'
  const originalSha = await gitBlobSha(rawOriginal)

  // 1) First pull + apply → seeds the local note (transformed, no frontmatter).
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', originalSha]]))
  mockGetBlobContent.mockResolvedValue(rawOriginal)
  const first = await pullFromGitHub({ token: 't', repo: REPO, notes: [], folders: [] })
  await applyNonConflicts(first.classifications)
  const noteId = useNoteStore.getState().notes[0].id

  // 2) The user does NOT touch the note. Local content stays exactly as applied.

  // 3) Remote changes its frontmatter tags (a real upstream edit). Because the
  //    user never touched local, this MUST be a clean take-remote.
  const rawRemoteNew = '---\ntags: [alpha, beta]\n---\n\nLine A\nLine B\nLine C\n'
  const remoteNewSha = await gitBlobSha(rawRemoteNew)

  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', remoteNewSha]]))
  // Serve the remote body for the loadRemote call, the original raw for a
  // pre-fix ancestor fetch (gitLastPushedSha = originalSha), and — once fixed —
  // the transformed-canonical bytes when the ancestor is fetched via the new
  // gitRemoteBaseSha. Route by SHA so call order is irrelevant.
  const transformedOriginal = '#alpha\n\nLine A\nLine B\nLine C\n'
  const transformedOriginalSha = await gitBlobSha(transformedOriginal)
  mockGetBlobContent.mockImplementation(async (_t, _o, _n, sha: string) => {
    if (sha === remoteNewSha) return rawRemoteNew
    if (sha === transformedOriginalSha) return transformedOriginal
    if (sha === originalSha) return rawOriginal
    return rawOriginal
  })

  const second = await pullFromGitHub({
    token: 't', repo: REPO,
    notes: useNoteStore.getState().notes,
    folders: [],
  })

  expect(second.classifications).toHaveLength(1)
  expect(second.classifications[0]).toMatchObject({
    kind: 'remoteUpdated',
    noteId,
    remoteSha: remoteNewSha,
  })
})
