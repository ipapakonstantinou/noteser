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
  listAttachmentPathsTracked: async () => ({ value: [], timedOut: false }),
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
import { GitHubProvider } from '../utils/gitHost/githubProvider'
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

  const first = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [] })
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
    provider: new GitHubProvider('t'), repo: REPO,
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
  const first = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [] })
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
    provider: new GitHubProvider('t'), repo: REPO,
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

// ── (c) pull-dedupe-by-path: unlinked local note is ADOPTED on apply ────────
//
// Regression guard for the "two Temp notes" twin. A local UNPUSHED note (no
// gitPath) whose notePath matches a remote `.md` must be reconciled against
// that remote file rather than spawning a second note. After apply, the
// existing note carries the now-linked gitPath; the note count stays at 1.
test('REPRO (c): unlinked local note matching a remote path is adopted on apply (no duplicate, gitPath linked)', async () => {
  // Seed a local note that has NEVER been pushed (gitPath null) but whose
  // title resolves to "Temp.md" — exactly the remote file we are about to pull.
  useNoteStore.setState({
    notes: [
      {
        id: 'local-temp',
        title: 'Temp',
        content: 'identical body\n',
        folderId: null,
        createdAt: 1,
        updatedAt: 1,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
        gitPath: null,
        gitLastPushedSha: null,
        gitRemoteBaseSha: null,
      },
    ],
    selectedNoteId: null,
  })

  // Remote Temp.md whose bytes are byte-identical to the local note's
  // serialized form → the reconcile adopts it as `unchanged` and just links
  // the gitPath.
  const rawRemote = 'identical body\n'
  const remoteSha = await gitBlobSha(rawRemote)
  mockGetTreeMap.mockResolvedValue(new Map([['Temp.md', remoteSha]]))
  mockGetBlobContent.mockResolvedValue(rawRemote)

  const pull = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO,
    notes: useNoteStore.getState().notes,
    folders: [],
  })

  // Classified as a reconcile against the existing note — NOT remoteCreated.
  expect(pull.classifications.find(c => c.kind === 'remoteCreated')).toBeUndefined()
  expect(pull.classifications[0]).toMatchObject({ kind: 'unchanged', noteId: 'local-temp', adoptPath: 'Temp.md' })

  await applyNonConflicts(pull.classifications)

  const stored = useNoteStore.getState().notes
  // Exactly ONE note — no twin.
  expect(stored).toHaveLength(1)
  expect(stored[0].id).toBe('local-temp')
  // Its gitPath is now linked to the remote file.
  expect(stored[0].gitPath).toBe('Temp.md')
})

test('REPRO (c2): non-identical unlinked local note adopts via remoteUpdated and links gitPath on apply', async () => {
  // Same setup, but the local note differs from remote AND has a remote base
  // SHA that lets the three-way classify it as a clean remoteUpdated (so we
  // exercise the remoteUpdated adopt-apply path, which must also set gitPath).
  const transformedBase = 'base body\n'
  const baseSha = await gitBlobSha(transformedBase)

  useNoteStore.setState({
    notes: [
      {
        id: 'local-temp',
        title: 'Temp',
        content: transformedBase, // local serializes to baseSha → localChanged=false
        folderId: null,
        createdAt: 1,
        updatedAt: 1,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
        // Stale gitPath not in the remote tree, but a remote base that matches
        // the local content → localChanged=false, remoteChanged=true → clean
        // remoteUpdated.
        gitPath: 'Old.md',
        gitLastPushedSha: baseSha,
        gitRemoteBaseSha: baseSha,
      },
    ],
    selectedNoteId: null,
  })

  const rawRemoteNew = 'updated remote body\n'
  const remoteNewSha = await gitBlobSha(rawRemoteNew)
  mockGetTreeMap.mockResolvedValue(new Map([['Temp.md', remoteNewSha]]))
  mockGetBlobContent.mockResolvedValue(rawRemoteNew)

  const pull = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO,
    notes: useNoteStore.getState().notes,
    folders: [],
  })

  expect(pull.classifications.find(c => c.kind === 'remoteCreated')).toBeUndefined()
  expect(pull.classifications[0]).toMatchObject({
    kind: 'remoteUpdated',
    noteId: 'local-temp',
    adoptPath: 'Temp.md',
  })

  await applyNonConflicts(pull.classifications)

  const stored = useNoteStore.getState().notes
  expect(stored).toHaveLength(1)
  expect(stored[0].id).toBe('local-temp')
  expect(stored[0].gitPath).toBe('Temp.md')
  expect(stored[0].content).toBe('updated remote body\n')
})

// ── rename-not-delete GUARD 1: content-hash adoption when the path FORM differs ──
//
// The catastrophe's pull-side trigger: the user reverted their remote vault to a
// DIFFERENT filename form than the notes' stored gitPaths (dash-form note path,
// space-form remote file). notePath() therefore no longer equals the remote
// path, so the existing path-form reconcile finds NO candidate — pre-fix the
// file became a NEW note (remoteCreated) and the original note was orphaned →
// later soft-deleted → its real file deleted on push.
//
// The fix adds a CONTENT-HASH fallback: an unlinked local note whose serialized
// blob SHA (or recorded gitLastPushedSha) equals the remote blob is ADOPTED to
// the new path. Here the note's stored gitPath is the dash-form `my-note.md`
// (absent from the remote tree → "unlinked"), notePath() resolves to the
// dash-form too, and the remote file is the SPACE-form `my note.md` with
// identical content. Only the content hash can match them.
test('REPRO (rename): unlinked note adopts a renamed remote file by CONTENT HASH when the path form differs', async () => {
  const body = 'shared body that survived the rename\n'
  const sha = await gitBlobSha(body)

  useNoteStore.setState({
    notes: [
      {
        id: 'renamed-note',
        // Dash-form title → notePath resolves to `my-note.md`, which is NOT the
        // space-form path the remote now uses.
        title: 'my-note',
        content: body,
        folderId: null,
        createdAt: 1,
        updatedAt: 1,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
        // Stale gitPath: the dash-form file is GONE from the remote tree (the
        // user renamed it to the space-form). This makes the note "unlinked".
        gitPath: 'my-note.md',
        gitLastPushedSha: sha,
        gitRemoteBaseSha: sha,
      },
    ],
    selectedNoteId: null,
  })

  // Remote now holds ONLY the space-form file, content-identical to the note.
  const remotePath = 'my note.md'
  mockGetTreeMap.mockResolvedValue(new Map([[remotePath, sha]]))
  mockGetBlobContent.mockResolvedValue(body)

  const pull = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO,
    notes: useNoteStore.getState().notes,
    folders: [],
  })

  // It must NOT be a NEW note (the twin / data-loss precursor) and must NOT be
  // remoteDeleted (the orphan-then-delete path).
  expect(pull.classifications.find(c => c.kind === 'remoteCreated')).toBeUndefined()
  expect(pull.classifications.find(c => c.kind === 'remoteDeleted')).toBeUndefined()
  // It IS an adoption of the existing note to the new (space-form) path.
  expect(pull.classifications[0]).toMatchObject({
    kind: 'unchanged',
    noteId: 'renamed-note',
    adoptPath: remotePath,
  })

  await applyNonConflicts(pull.classifications)
  const stored = useNoteStore.getState().notes
  expect(stored).toHaveLength(1)
  expect(stored[0].id).toBe('renamed-note')
  // gitPath now tracks the renamed remote file — no orphan, no delete.
  expect(stored[0].gitPath).toBe(remotePath)
})
