/**
 * @jest-environment node
 *
 * syncApply.test.ts
 *
 * Direct unit-test coverage for the APPLY half of the GitHub sync —
 * `applyNonConflicts`, the conflict resolvers (`applyMergedConflict` /
 * `applyConflictResolution`), and `applyAttachmentClassifications`.
 *
 * Until now the apply layer had no direct tests: the classifier
 * (githubSyncClassify.test.ts) and the round-trip invariant
 * (githubSyncRoundtrip.test.ts) exercised pull + a little apply, but
 * nothing asserted the resulting notes[]/folders[] state or the
 * ApplyCounts the apply functions return. This is exactly where the
 * "transformed content vs raw remote SHA" data-integrity bug lived: a
 * frontmatter note's gitLastPushedSha was pinned to the raw remote SHA
 * while we stored the TRANSFORMED body, so an untouched note never
 * settled to `unchanged` and genuine conflicts could be silently merged.
 *
 * Strategy (mirrors githubSyncRoundtrip.test.ts):
 *   - node test env so crypto.subtle is real → gitBlobSha is REAL.
 *   - idb-keyval mocked (Zustand persist + attachments).
 *   - github.ts: only the network surface mocked; gitBlobSha /
 *     gitBlobShaBytes stay REAL so the canonical-SHA assertions exercise
 *     the genuine serialize → SHA-1 → compare path.
 *   - attachments util mocked so putAttachmentAtPath is observable.
 *   - the real note / folder / settings stores are driven directly.
 */

// ── idb-keyval mock (Zustand persist + attachments) ─────────────────────────
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// ── attachments util mock — putAttachmentAtPath observable ──────────────────
const mockPutAttachmentAtPath = jest.fn().mockResolvedValue(undefined)
jest.mock('../utils/attachments', () => ({
  isAttachmentPath: (p: string) => p.startsWith('attachments/'),
  listAttachmentPaths: async () => [],
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
  getAttachmentTombstones: async () => [],
  clearAttachmentTombstones: async () => undefined,
  putAttachmentAtPath: (...a: unknown[]) => mockPutAttachmentAtPath(...a),
}))

// ── github.ts mock — network funcs mocked, hashing REAL ─────────────────────
const mockGetBranchRefSha = jest.fn()
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()
const mockGetBlobBytes = jest.fn()

jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github')
  return {
    ...actual,
    getBranchRefSha: (...a: unknown[]) => mockGetBranchRefSha(...a),
    getCommitTreeSha: (...a: unknown[]) => mockGetCommitTreeSha(...a),
    getTreeMap: (...a: unknown[]) => mockGetTreeMap(...a),
    getBlobContent: (...a: unknown[]) => mockGetBlobContent(...a),
    getBlobBytes: (...a: unknown[]) => mockGetBlobBytes(...a),
    // gitBlobSha / gitBlobShaBytes stay REAL (spread from actual).
  }
})

import {
  applyNonConflicts,
  applyMergedConflict,
  applyConflictResolution,
  applyAttachmentClassifications,
  bodyWithInlineTags,
} from '../utils/syncApply'
import { pullFromGitHub, serializeNote, type PullClassification } from '../utils/githubSync'
import { gitBlobSha } from '../utils/github'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useGitHubStore } from '../stores/githubStore'
import type { Note, SyncRepo } from '@/types'

const REPO: SyncRepo = { owner: 'me', name: 'vault', branch: 'main', isPrivate: false }

// Canonical local SHA helper — the SAME canonicaliser the apply code uses
// internally (gitBlobSha(serializeNote({ content }))). We re-derive it in
// the test rather than importing the private helper so the assertion is
// independent of the implementation detail.
function canonicalSha(content: string): Promise<string> {
  return gitBlobSha(serializeNote({ content } as Note))
}

function seedNote(input: Partial<Note> & { id: string; title: string }): Note {
  return {
    id: input.id,
    title: input.title,
    content: input.content ?? '',
    folderId: input.folderId ?? null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: input.isDeleted ?? false,
    deletedAt: input.deletedAt ?? null,
    isPinned: false,
    templateId: null,
    gitPath: input.gitPath ?? null,
    gitLastPushedSha: input.gitLastPushedSha ?? null,
    gitRemoteBaseSha: input.gitRemoteBaseSha ?? null,
  } as Note
}

beforeEach(async () => {
  jest.clearAllMocks()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  mockGetCommitTreeSha.mockResolvedValue('treesha')
  // Fresh stores each test.
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {}, deletedFolderPaths: [] })
  // Reset just the settings the apply layer reads — use setState (not the
  // store's reset()) to avoid a noisy "storage unavailable" persist warning
  // in the node test env.
  useSettingsStore.setState({
    localGitignoreOverlay: '',
    folderSortMode: 'alphabetical',
    trashMode: 'trash',
    vaultSettingsUpdatedAt: 0,
    vaultSettingsLastPushedHash: '',
  })
  useGitHubStore.setState({ token: null, syncRepo: null })
})

// ── remoteCreated ────────────────────────────────────────────────────────────

test('remoteCreated: creates a note at the repo root, content = bodyWithInlineTags, both SHAs pinned correctly', async () => {
  const remoteSha = 'remote-blob-sha-root'
  const c: PullClassification = {
    kind: 'remoteCreated',
    path: 'Hello.md',
    remoteSha,
    remoteContent: '---\ntags: [alpha]\n---\n\nHello world\n',
    tags: ['alpha'],
    body: '\nHello world\n',
  }

  const counts = await applyNonConflicts([c])

  expect(counts).toEqual({ created: 1, updated: 0, deleted: 0, autoMerged: 0 })

  const notes = useNoteStore.getState().notes
  expect(notes).toHaveLength(1)
  const note = notes[0]
  expect(note.title).toBe('Hello')
  expect(note.folderId).toBeNull()
  expect(note.gitPath).toBe('Hello.md')
  // Content = bodyWithInlineTags(body, tags).
  expect(note.content).toBe(bodyWithInlineTags('\nHello world\n', ['alpha']))
  // CRITICAL (the regression-bug guard): gitLastPushedSha is the canonical
  // local SHA of the STORED bytes, NOT the raw remote SHA.
  expect(note.gitLastPushedSha).toBe(await canonicalSha(note.content))
  expect(note.gitLastPushedSha).not.toBe(remoteSha)
  // gitRemoteBaseSha is the raw remote blob SHA (the 3-way ancestor).
  expect(note.gitRemoteBaseSha).toBe(remoteSha)
})

test('remoteCreated: nested path materialises the folder hierarchy via ensureFolderPath', async () => {
  const c: PullClassification = {
    kind: 'remoteCreated',
    path: 'Work/Q1/Plan.md',
    remoteSha: 'sha-nested',
    remoteContent: 'no frontmatter body\n',
    tags: [],
    body: 'no frontmatter body\n',
  }

  const counts = await applyNonConflicts([c])
  expect(counts.created).toBe(1)

  const folders = useFolderStore.getState().getActiveFolders()
  const names = folders.map(f => f.name)
  // Two folders created: Work and Q1 (nested).
  expect(names).toContain('Work')
  expect(names).toContain('Q1')

  const note = useNoteStore.getState().notes[0]
  expect(note.title).toBe('Plan')
  // The note's folderId is the LEAF folder (Q1).
  const work = folders.find(f => f.name === 'Work')!
  const q1 = folders.find(f => f.name === 'Q1')!
  expect(q1.parentId).toBe(work.id)
  expect(note.folderId).toBe(q1.id)
  // No-frontmatter body is stored verbatim.
  expect(note.content).toBe('no frontmatter body\n')
})

// ── remoteUpdated ────────────────────────────────────────────────────────────

test('remoteUpdated: updates the existing note content + both SHAs', async () => {
  useNoteStore.setState({
    notes: [seedNote({
      id: 'n1', title: 'Foo', content: 'old body\n',
      gitPath: 'Foo.md', gitLastPushedSha: 'old-canon', gitRemoteBaseSha: 'old-remote',
    })],
    selectedNoteId: 'n1',
  })

  const remoteSha = 'remote-updated-sha'
  const c: PullClassification = {
    kind: 'remoteUpdated',
    noteId: 'n1',
    remoteSha,
    remoteContent: 'new body\n',
    tags: ['beta'],
    body: 'new body\n',
  }

  const counts = await applyNonConflicts([c])
  expect(counts).toEqual({ created: 0, updated: 1, deleted: 0, autoMerged: 0 })

  const note = useNoteStore.getState().notes.find(n => n.id === 'n1')!
  expect(note.content).toBe(bodyWithInlineTags('new body\n', ['beta']))
  expect(note.gitLastPushedSha).toBe(await canonicalSha(note.content))
  expect(note.gitRemoteBaseSha).toBe(remoteSha)
})

test('remoteUpdated: a noteId with no matching local note is skipped (no crash, no count)', async () => {
  const c: PullClassification = {
    kind: 'remoteUpdated',
    noteId: 'ghost',
    remoteSha: 'x',
    remoteContent: 'body\n',
    tags: [],
    body: 'body\n',
  }
  const counts = await applyNonConflicts([c])
  expect(counts.updated).toBe(0)
  expect(useNoteStore.getState().notes).toHaveLength(0)
})

// ── autoMerged ───────────────────────────────────────────────────────────────

test('autoMerged: stores merged content, gitLastPushedSha = canonical SHA of merged bytes, gitRemoteBaseSha = remoteSha', async () => {
  useNoteStore.setState({
    notes: [seedNote({
      id: 'n1', title: 'Foo', content: 'line1\nline2\nline3\n',
      gitPath: 'Foo.md', gitLastPushedSha: 'canon-old', gitRemoteBaseSha: 'remote-old',
    })],
    selectedNoteId: 'n1',
  })

  const remoteSha = 'remote-merged-base'
  const mergedContent = 'line1 (local)\nline2\nline3 (remote)\n'
  const c: PullClassification = {
    kind: 'autoMerged',
    noteId: 'n1',
    remoteSha,
    mergedContent,
  }

  const counts = await applyNonConflicts([c])
  expect(counts).toEqual({ created: 0, updated: 1, deleted: 0, autoMerged: 1 })

  const note = useNoteStore.getState().notes.find(n => n.id === 'n1')!
  expect(note.content).toBe(mergedContent)
  expect(note.gitLastPushedSha).toBe(await canonicalSha(mergedContent))
  expect(note.gitRemoteBaseSha).toBe(remoteSha)
})

// ── remoteDeleted ────────────────────────────────────────────────────────────

test('remoteDeleted: soft-deletes the note (isDeleted true, deletedAt set), counts.deleted bumped', async () => {
  useNoteStore.setState({
    notes: [seedNote({ id: 'n1', title: 'Bye', content: 'bye\n', gitPath: 'Bye.md', gitLastPushedSha: 's' })],
    selectedNoteId: 'n1',
  })

  const counts = await applyNonConflicts([{ kind: 'remoteDeleted', noteId: 'n1' }])
  expect(counts).toEqual({ created: 0, updated: 0, deleted: 1, autoMerged: 0 })

  const note = useNoteStore.getState().notes.find(n => n.id === 'n1')!
  expect(note.isDeleted).toBe(true)
  expect(note.deletedAt).toEqual(expect.any(Number))
  // Soft delete only — the note is NOT removed from the array.
  expect(useNoteStore.getState().notes).toHaveLength(1)
})

// ── folderCreated ────────────────────────────────────────────────────────────

test('folderCreated: materialises an empty folder path (and its parents)', async () => {
  const counts = await applyNonConflicts([{ kind: 'folderCreated', path: '.obsidian/themes' }])
  // folderCreated is not counted as a note change.
  expect(counts).toEqual({ created: 0, updated: 0, deleted: 0, autoMerged: 0 })

  const folders = useFolderStore.getState().getActiveFolders()
  const names = folders.map(f => f.name)
  expect(names).toContain('.obsidian')
  expect(names).toContain('themes')
  const obsidian = folders.find(f => f.name === '.obsidian')!
  const themes = folders.find(f => f.name === 'themes')!
  expect(themes.parentId).toBe(obsidian.id)
  expect(useNoteStore.getState().notes).toHaveLength(0)
})

// ── skipped kinds (unchanged / conflict / conflictDeleted / attachments) ─────

test('applyNonConflicts skips unchanged / conflict / conflictDeleted / attachment kinds', async () => {
  useNoteStore.setState({
    notes: [seedNote({ id: 'n1', title: 'Foo', content: 'body\n', gitPath: 'Foo.md', gitLastPushedSha: 's' })],
    selectedNoteId: 'n1',
  })

  const classifications: PullClassification[] = [
    { kind: 'unchanged', noteId: 'n1' },
    { kind: 'conflict', noteId: 'n1', path: 'Foo.md', localContent: 'l', remoteSha: 'r', remoteContent: 'rc', remoteTags: [], remoteBody: 'rc' },
    { kind: 'conflictDeleted', noteId: 'n1', path: 'Foo.md', localContent: 'l' },
    { kind: 'attachmentCreated', path: 'attachments/x.png', remoteSha: 'a', mime: 'image/png' },
    { kind: 'attachmentUpdated', path: 'attachments/y.png', remoteSha: 'b', mime: 'image/png' },
  ]

  const before = useNoteStore.getState().notes[0]
  const counts = await applyNonConflicts(classifications)
  expect(counts).toEqual({ created: 0, updated: 0, deleted: 0, autoMerged: 0 })
  // The note is untouched.
  expect(useNoteStore.getState().notes[0]).toEqual(before)
})

// ── selectedNoteId behaviour ─────────────────────────────────────────────────

test('applyNonConflicts selects the last created note when nothing was selected', async () => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  await applyNonConflicts([
    { kind: 'remoteCreated', path: 'A.md', remoteSha: 's1', remoteContent: 'a\n', tags: [], body: 'a\n' },
    { kind: 'remoteCreated', path: 'B.md', remoteSha: 's2', remoteContent: 'b\n', tags: [], body: 'b\n' },
  ])
  const { notes, selectedNoteId } = useNoteStore.getState()
  const last = notes.find(n => n.title === 'B')!
  expect(selectedNoteId).toBe(last.id)
})

test('applyNonConflicts preserves an existing selection', async () => {
  useNoteStore.setState({
    notes: [seedNote({ id: 'keep', title: 'Keep' })],
    selectedNoteId: 'keep',
  })
  await applyNonConflicts([
    { kind: 'remoteCreated', path: 'New.md', remoteSha: 's', remoteContent: 'n\n', tags: [], body: 'n\n' },
  ])
  expect(useNoteStore.getState().selectedNoteId).toBe('keep')
})

// ── vaultSettings classifications ────────────────────────────────────────────

test('vaultSettingsUpdated: applies the remote slice + counts as updated', async () => {
  useSettingsStore.setState({ folderSortMode: 'alphabetical', vaultSettingsUpdatedAt: 100 })

  const c: PullClassification = {
    kind: 'vaultSettingsUpdated',
    path: '.noteser/settings.json',
    remoteSha: 'sha-settings',
    remoteUpdatedAt: 9999,
    remoteVault: { folderSortMode: 'modified' },
    remoteHash: 'remote-hash',
  }

  const counts = await applyNonConflicts([c])
  expect(counts.updated).toBe(1)

  const s = useSettingsStore.getState()
  expect(s.folderSortMode).toBe('modified')
  // The store advances vaultSettingsUpdatedAt + lastPushedHash so the next
  // push doesn't treat this as a local change.
  expect(s.vaultSettingsUpdatedAt).toBe(9999)
  expect(s.vaultSettingsLastPushedHash).toBe('remote-hash')
})

// ── THE ROUND-TRIP INVARIANT (the exact regression guard) ────────────────────
//
// Apply a remoteCreated frontmatter note, then feed the resulting note back
// through pullFromGitHub against the SAME remote tree. It MUST classify
// `unchanged` — proving gitLastPushedSha names bytes the app can reproduce
// from the stored (transformed) note, not the raw remote file. Pre-fix this
// would be a phantom localChanged → re-push / silent-merge.

test('ROUND-TRIP INVARIANT: a pulled frontmatter note re-classifies as `unchanged`, never locally-changed', async () => {
  const rawRemote = '---\ntags: [a]\n---\n\nHello\n'
  const remoteSha = await gitBlobSha(rawRemote)

  // First pull: remote-only file → remoteCreated.
  mockGetTreeMap.mockResolvedValue(new Map([['Note.md', remoteSha]]))
  mockGetBlobContent.mockResolvedValue(rawRemote)

  const first = await pullFromGitHub({ token: 't', repo: REPO, notes: [], folders: [] })
  expect(first.classifications.find(c => c.kind === 'remoteCreated')).toBeDefined()

  await applyNonConflicts(first.classifications)
  const stored = useNoteStore.getState().notes
  expect(stored).toHaveLength(1)

  // Independent re-derivation of the stored note's canonical blob SHA must
  // equal the pinned gitLastPushedSha. This is the invariant in isolation:
  // the bytes named by gitLastPushedSha ARE reproducible from the note.
  const reDerived = await gitBlobSha(serializeNote(stored[0]))
  expect(stored[0].gitLastPushedSha).toBe(reDerived)
  // ...and it is distinct from the raw remote SHA (frontmatter note).
  expect(stored[0].gitLastPushedSha).not.toBe(remoteSha)
  expect(stored[0].gitRemoteBaseSha).toBe(remoteSha)

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

// ── applyMergedConflict ──────────────────────────────────────────────────────
//
// The user produced a merged raw file in the merge editor. We store the
// parsed body (frontmatter stripped, tags inlined) and pin BOTH SHAs to the
// RAW remote SHA — a DELIBERATE mismatch that keeps localChanged = true so the
// resolution gets pushed on the next sync, while remoteChanged = false so it
// doesn't re-conflict.

test('applyMergedConflict: stores parsed merged body + pins both SHAs to the remote SHA', async () => {
  useNoteStore.setState({
    notes: [seedNote({ id: 'n1', title: 'Foo', content: 'whatever\n', gitPath: 'Foo.md', gitLastPushedSha: 'old', gitRemoteBaseSha: 'old' })],
    selectedNoteId: 'n1',
  })

  const c = {
    kind: 'conflict' as const,
    noteId: 'n1',
    path: 'Foo.md',
    localContent: 'local\n',
    remoteSha: 'the-remote-sha',
    remoteContent: 'remote\n',
    remoteTags: [],
    remoteBody: 'remote\n',
  }

  // The merged raw file the user cherry-picked (with a tags frontmatter to
  // prove we re-parse + inline).
  applyMergedConflict(c, '---\ntags: [merged]\n---\n\nmerged body\n')

  const note = useNoteStore.getState().notes.find(n => n.id === 'n1')!
  expect(note.content).toBe(bodyWithInlineTags('\nmerged body\n', ['merged']))
  // Both SHAs pinned to the RAW remote SHA (intentional localChanged mismatch).
  expect(note.gitLastPushedSha).toBe('the-remote-sha')
  expect(note.gitRemoteBaseSha).toBe('the-remote-sha')
})

// ── applyConflictResolution: choice 'remote' / 'local' ───────────────────────

test("applyConflictResolution conflict + 'remote': takes remote body, pins both SHAs to remote SHA", async () => {
  useNoteStore.setState({
    notes: [seedNote({ id: 'n1', title: 'Foo', content: 'local body\n', gitPath: 'Foo.md', gitLastPushedSha: 'old', gitRemoteBaseSha: 'old' })],
    selectedNoteId: 'n1',
  })

  const c = {
    kind: 'conflict' as const,
    noteId: 'n1',
    path: 'Foo.md',
    localContent: 'local body\n',
    remoteSha: 'remote-sha',
    remoteContent: '---\ntags: [r]\n---\n\nremote body\n',
    remoteTags: ['r'],
    remoteBody: '\nremote body\n',
  }

  applyConflictResolution(c, 'remote')

  const note = useNoteStore.getState().notes.find(n => n.id === 'n1')!
  expect(note.content).toBe(bodyWithInlineTags('\nremote body\n', ['r']))
  expect(note.gitLastPushedSha).toBe('remote-sha')
  expect(note.gitRemoteBaseSha).toBe('remote-sha')
})

test("applyConflictResolution conflict + 'local': keeps local content, pins both SHAs to remote SHA", async () => {
  useNoteStore.setState({
    notes: [seedNote({ id: 'n1', title: 'Foo', content: 'local body\n', gitPath: 'Foo.md', gitLastPushedSha: 'old', gitRemoteBaseSha: 'old' })],
    selectedNoteId: 'n1',
  })

  const c = {
    kind: 'conflict' as const,
    noteId: 'n1',
    path: 'Foo.md',
    localContent: 'local body\n',
    remoteSha: 'remote-sha',
    remoteContent: 'remote body\n',
    remoteTags: [],
    remoteBody: 'remote body\n',
  }

  applyConflictResolution(c, 'local')

  const note = useNoteStore.getState().notes.find(n => n.id === 'n1')!
  // Content untouched — local wins.
  expect(note.content).toBe('local body\n')
  // SHAs pinned: gitRemoteBaseSha = remote (so next pull = remoteChanged
  // false), gitLastPushedSha = remote too (a deliberate mismatch vs the
  // canonical local SHA → localChanged true → push-only).
  expect(note.gitLastPushedSha).toBe('remote-sha')
  expect(note.gitRemoteBaseSha).toBe('remote-sha')
})

// ── applyConflictResolution: conflictDeleted respawn / accept ────────────────

test("applyConflictResolution conflictDeleted + 'local': respawns by clearing gitPath + both SHAs", async () => {
  useNoteStore.setState({
    notes: [seedNote({ id: 'n1', title: 'Foo', content: 'edited\n', gitPath: 'Foo.md', gitLastPushedSha: 'old', gitRemoteBaseSha: 'old' })],
    selectedNoteId: 'n1',
  })

  const c = {
    kind: 'conflictDeleted' as const,
    noteId: 'n1',
    path: 'Foo.md',
    localContent: 'edited\n',
  }

  applyConflictResolution(c, 'local')

  const note = useNoteStore.getState().notes.find(n => n.id === 'n1')!
  // Treated like a fresh local note — push will create the file from scratch.
  expect(note.gitPath).toBeNull()
  expect(note.gitLastPushedSha).toBeNull()
  expect(note.gitRemoteBaseSha).toBeNull()
  // Still present (not deleted) — the local edits live on.
  expect(note.isDeleted).toBe(false)
})

test("applyConflictResolution conflictDeleted + 'remote': accepts the delete (soft-deletes the note)", async () => {
  useNoteStore.setState({
    notes: [seedNote({ id: 'n1', title: 'Foo', content: 'edited\n', gitPath: 'Foo.md', gitLastPushedSha: 'old', gitRemoteBaseSha: 'old' })],
    selectedNoteId: 'n1',
  })

  const c = {
    kind: 'conflictDeleted' as const,
    noteId: 'n1',
    path: 'Foo.md',
    localContent: 'edited\n',
  }

  applyConflictResolution(c, 'remote')

  const note = useNoteStore.getState().notes.find(n => n.id === 'n1')!
  // deleteNote in the default trash mode soft-deletes.
  expect(note.isDeleted).toBe(true)
})

// ── applyAttachmentClassifications ───────────────────────────────────────────
//
// attachmentCreated/Updated aren't handled by applyNonConflicts — they go
// through applyAttachmentClassifications, which fetches bytes (here via the
// mocked getBlobBytes, since the zipball cache is empty) and writes them to
// IDB via putAttachmentAtPath. We assert it doesn't crash, calls
// putAttachmentAtPath, and returns the right counts.

test('applyAttachmentClassifications: created + updated fetch bytes and write via putAttachmentAtPath', async () => {
  useGitHubStore.setState({ token: 'tok', syncRepo: REPO })
  mockGetBlobBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))

  const classifications: PullClassification[] = [
    { kind: 'attachmentCreated', path: 'attachments/new.png', remoteSha: 'sha-new', mime: 'image/png' },
    { kind: 'attachmentUpdated', path: 'attachments/upd.png', remoteSha: 'sha-upd', mime: 'image/png' },
    // a note classification is ignored by the attachment apply.
    { kind: 'remoteCreated', path: 'X.md', remoteSha: 's', remoteContent: 'x\n', tags: [], body: 'x\n' },
  ]

  const counts = await applyAttachmentClassifications(classifications)
  expect(counts).toEqual({ created: 1, updated: 1, failed: 0 })
  expect(mockPutAttachmentAtPath).toHaveBeenCalledTimes(2)
  expect(mockGetBlobBytes).toHaveBeenCalledTimes(2)
  const writtenPaths = mockPutAttachmentAtPath.mock.calls.map(call => call[0]).sort()
  expect(writtenPaths).toEqual(['attachments/new.png', 'attachments/upd.png'])
})

test('applyAttachmentClassifications: a single failed fetch is counted, not thrown', async () => {
  useGitHubStore.setState({ token: 'tok', syncRepo: REPO })
  mockGetBlobBytes.mockRejectedValue(new Error('blob fetch boom'))
  // Silence the expected console.error.
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})

  const counts = await applyAttachmentClassifications([
    { kind: 'attachmentCreated', path: 'attachments/bad.png', remoteSha: 'sha-bad', mime: 'image/png' },
  ])

  expect(counts).toEqual({ created: 0, updated: 0, failed: 1 })
  expect(mockPutAttachmentAtPath).not.toHaveBeenCalled()
  spy.mockRestore()
})

test('applyAttachmentClassifications: no attachment classifications → all-zero counts, no fetch', async () => {
  const counts = await applyAttachmentClassifications([
    { kind: 'remoteCreated', path: 'X.md', remoteSha: 's', remoteContent: 'x\n', tags: [], body: 'x\n' },
  ])
  expect(counts).toEqual({ created: 0, updated: 0, failed: 0 })
  expect(mockGetBlobBytes).not.toHaveBeenCalled()
})

// ── mixed batch through applyNonConflicts ────────────────────────────────────

test('applyNonConflicts processes a mixed batch in one pass with correct aggregate counts', async () => {
  useNoteStore.setState({
    notes: [
      seedNote({ id: 'upd', title: 'Upd', content: 'old\n', gitPath: 'Upd.md', gitLastPushedSha: 'a', gitRemoteBaseSha: 'a' }),
      seedNote({ id: 'del', title: 'Del', content: 'bye\n', gitPath: 'Del.md', gitLastPushedSha: 'b' }),
      seedNote({ id: 'mrg', title: 'Mrg', content: 'l1\nl2\n', gitPath: 'Mrg.md', gitLastPushedSha: 'c', gitRemoteBaseSha: 'c' }),
    ],
    selectedNoteId: 'upd',
  })

  const counts = await applyNonConflicts([
    { kind: 'remoteCreated', path: 'Sub/New.md', remoteSha: 's-new', remoteContent: 'n\n', tags: [], body: 'n\n' },
    { kind: 'remoteUpdated', noteId: 'upd', remoteSha: 's-upd', remoteContent: 'new\n', tags: [], body: 'new\n' },
    { kind: 'autoMerged', noteId: 'mrg', remoteSha: 's-mrg', mergedContent: 'l1\nl2 merged\n' },
    { kind: 'remoteDeleted', noteId: 'del' },
    { kind: 'folderCreated', path: 'EmptyDir' },
  ])

  expect(counts).toEqual({ created: 1, updated: 2, deleted: 1, autoMerged: 1 })

  const notes = useNoteStore.getState().notes
  expect(notes.find(n => n.title === 'New')).toBeDefined()
  expect(notes.find(n => n.id === 'del')!.isDeleted).toBe(true)
  expect(notes.find(n => n.id === 'mrg')!.content).toBe('l1\nl2 merged\n')

  const folderNames = useFolderStore.getState().getActiveFolders().map(f => f.name)
  expect(folderNames).toEqual(expect.arrayContaining(['Sub', 'EmptyDir']))
})
