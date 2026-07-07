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
import { GitHubProvider } from '../utils/gitHost/githubProvider'
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
    gitRemoteBaseSha: input.gitRemoteBaseSha ?? null,
  } as Note
}

beforeEach(async () => {
  jest.clearAllMocks()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  mockGetCommitTreeSha.mockResolvedValue('treesha')
  // Reset the per-device gitignore overlay so a setting from a
  // previous test doesn't leak through into the next pull.
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: '' })
})

// ── unchanged ───────────────────────────────────────────────────────────────

test('classifies a stable local note with matching remote SHA as unchanged', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-foo']]))
  mockGitBlobSha.mockResolvedValue('sha-foo')

  const local: Note[] = [note({ id: '1', title: 'Foo', content: 'body', gitPath: 'Foo.md', gitLastPushedSha: 'sha-foo' })]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toEqual({ kind: 'unchanged', noteId: '1' })
  // unchanged path doesn't fetch the blob.
  expect(mockGetBlobContent).not.toHaveBeenCalled()
})

// ── remoteCreated ───────────────────────────────────────────────────────────

test('classifies a remote-only file (no local match) as remoteCreated', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Brand new.md', 'sha-new']]))
  mockGetBlobContent.mockResolvedValue('hello world')

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [] })

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
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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

  const result = await syncToGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

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

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [] })

  const kinds = classifications.map(c => c.kind).sort()
  expect(kinds).toContain('remoteCreated')
  expect(kinds).toContain('attachmentCreated')
  // The markdown classification for Note.md should be the only "note-shaped" one.
  const noteClassifications = classifications.filter(c => c.kind === 'remoteCreated')
  expect(noteClassifications).toHaveLength(1)
})

// ── folder derivation skips dying paths ────────────────────────────────────
// Regression: deleting a folder (and moving its notes to root) used to
// re-derive the folder on the very next pull, because the moved notes
// still carried the old `.foo/note.md` gitPath. Pull saw the remote blob
// at `.foo/note.md`, classified the note as "unchanged" (SHA matched),
// but ALSO walked the parent dir `.foo/` and emitted folderCreated.
// Push would clean the remote afterwards — too late, the folder was
// already back locally.
test('folder derivation skips parents of dying paths (deleted-folder re-derive bug)', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([
    ['.foo/note.md', 'sha-foo'],
  ]))
  mockGitBlobSha.mockResolvedValue('sha-foo')

  // Note still carries its old gitPath inside .foo, but folderId is now
  // null (user deleted .foo, cascadeDelete moved the note to root).
  const local: Note[] = [
    note({ id: '1', title: 'note', content: '', gitPath: '.foo/note.md', gitLastPushedSha: 'sha-foo', folderId: null }),
  ]

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  const folderCreates = classifications.filter(c => c.kind === 'folderCreated')
  expect(folderCreates).toHaveLength(0)
})

test('folder derivation still fires for genuinely-remote folders', async () => {
  // Same tree, but NO local note for the file → folder is real and
  // should be materialised so the user sees it in the sidebar.
  mockGetTreeMap.mockResolvedValue(new Map([
    ['.foo/note.md', 'sha-foo'],
  ]))
  mockGetBlobContent.mockResolvedValue('body')

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [] })

  const folderCreates = classifications.filter(c => c.kind === 'folderCreated')
  expect(folderCreates.map(c => (c as { path: string }).path)).toContain('.foo')
})

test('folder derivation skips parents of soft-deleted notes', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([
    ['.foo/note.md', 'sha-foo'],
  ]))
  mockGitBlobSha.mockResolvedValue('sha-foo')

  const local: Note[] = [
    note({ id: '1', title: 'note', content: '', gitPath: '.foo/note.md', gitLastPushedSha: 'sha-foo', isDeleted: true }),
  ]

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  const folderCreates = classifications.filter(c => c.kind === 'folderCreated')
  expect(folderCreates).toHaveLength(0)
})

// ── tombstones for explicitly-deleted folders ──────────────────────────────
// The "skip pending-removed parents" branch only catches paths matching
// LOCAL NOTES. A hidden folder like .obsidian/ contains JSON / config
// files that have no local note record — without an explicit tombstone
// the pull walks those parents and re-derives the folder the user just
// removed.

test('excludedFolderPaths tombstones a hidden folder from being re-derived', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([
    ['.obsidian/config.json', 'sha-cfg'],
    ['.obsidian/plugins/foo.js', 'sha-plug'],
  ]))

  const { classifications } = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
    excludedFolderPaths: ['.obsidian'],
  })

  const folderCreates = classifications.filter(c => c.kind === 'folderCreated')
  expect(folderCreates).toHaveLength(0)
})

test('excludedFolderPaths also blocks nested paths inside the tombstone', async () => {
  // `.obsidian/themes/dark/` should also be blocked because `.obsidian`
  // is tombstoned — otherwise the dir-walk would emit folderCreated for
  // `.obsidian/themes` and `.obsidian/themes/dark` as separate entries.
  mockGetTreeMap.mockResolvedValue(new Map([
    ['.obsidian/themes/dark/theme.css', 'sha-css'],
  ]))

  const { classifications } = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
    excludedFolderPaths: ['.obsidian'],
  })

  const folderCreates = classifications.filter(c => c.kind === 'folderCreated')
  expect(folderCreates).toHaveLength(0)
})

test('excludedFolderPaths leaves OTHER folders alone', async () => {
  // Sibling folders not in the tombstone list should still be derived.
  mockGetTreeMap.mockResolvedValue(new Map([
    ['.obsidian/config.json', 'sha-cfg'],
    ['Daily-Notes/2026-05-20.md', 'sha-daily'],
  ]))
  mockGetBlobContent.mockResolvedValue('body')

  const { classifications } = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
    excludedFolderPaths: ['.obsidian'],
  })

  const folderCreates = classifications
    .filter(c => c.kind === 'folderCreated')
    .map(c => (c as { path: string }).path)
  expect(folderCreates).toContain('Daily-Notes')
  expect(folderCreates).not.toContain('.obsidian')
})

// ── gi9n: vault-level .gitignore ───────────────────────────────────────────
// The pull layer reads `.gitignore` from the remote tree, compiles it,
// and filters classifications + folder derivation through the matcher.
// When no `.gitignore` exists, the OS-junk defaults still kick in.

test('pull skips remote .md files matching a vault .gitignore', async () => {
  // Remote has a .gitignore that excludes private/ + a normal note.
  mockGetTreeMap.mockResolvedValue(new Map([
    ['.gitignore', 'sha-gi'],
    ['private/secret.md', 'sha-secret'],
    ['Notes/keep.md', 'sha-keep'],
  ]))
  mockGetBlobContent.mockImplementation(async (_t, _o, _n, sha: string) => {
    if (sha === 'sha-gi') return 'private/\n'
    return 'body'
  })

  const { classifications } = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
  })

  // The keeper survives; the ignored one is filtered out completely.
  const remoteCreates = classifications.filter(c => c.kind === 'remoteCreated')
  expect(remoteCreates.map(c => (c as { path: string }).path)).toEqual(['Notes/keep.md'])
  // The parent dir of the ignored file shouldn't be derived either.
  const folderCreates = classifications.filter(c => c.kind === 'folderCreated')
  expect(folderCreates.map(c => (c as { path: string }).path)).not.toContain('private')
})

// ── vs8x conflict detection ────────────────────────────────────────────────

test('vault settings conflict — local + remote both dirty since last sync', async () => {
  const { useSettingsStore, VAULT_SETTING_KEYS } = await import('../stores/settingsStore')
  // Simulate "local has unpushed edits": vaultSettingsLastPushedHash
  // is set to an OLD value, the current local slice hashes to
  // something different.
  void VAULT_SETTING_KEYS
  useSettingsStore.setState({
    vaultSettingsLastPushedHash: 'stale-hash',
    vaultSettingsUpdatedAt: 1000,
    folderSortMode: 'modified',  // local change
    taskListDensity: 'comfortable',
  })

  mockGetTreeMap.mockResolvedValue(new Map([
    ['.noteser/settings.json', 'sha-settings'],
  ]))
  // Remote settings file: newer + a DIFFERENT folderSortMode.
  mockGetBlobContent.mockResolvedValue(JSON.stringify({
    version: 1,
    updatedAt: 9999,
    vault: { folderSortMode: 'alphabetical', taskListDensity: 'compact' },
  }))

  const { classifications } = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
    vaultSettingsPath: '.noteser/settings.json',
    vaultSettingsLocalUpdatedAt: 1000,
  })

  const conflict = classifications.find(c => c.kind === 'vaultSettingsConflict')
  expect(conflict).toBeDefined()
  if (conflict?.kind === 'vaultSettingsConflict') {
    // The two keys I explicitly changed in local + the remote MUST
    // both appear. Other vault keys may also be in diffKeys because
    // the remote payload only carries a partial vault — that's fine,
    // the modal lets the user resolve each one.
    expect(conflict.diffKeys).toEqual(expect.arrayContaining(['folderSortMode', 'taskListDensity']))
    expect(conflict.localVault.folderSortMode).toBe('modified')
    expect(conflict.remoteVault.folderSortMode).toBe('alphabetical')
  }
})

test('vault settings updates (not conflict) when local is clean', async () => {
  const { useSettingsStore } = await import('../stores/settingsStore')
  // Simulate "local matches last pushed": current slice hashes to
  // exactly vaultSettingsLastPushedHash so there's no unsynced change.
  // We pin both by serializing once + storing the hash + state.
  const { serializeVaultSettings, vaultSettingsHash, pickVaultSlice: pick } = await import('../utils/vaultSettings')
  useSettingsStore.setState({
    vaultSettingsUpdatedAt: 1000,
    folderSortMode: 'alphabetical',
  })
  const localCanonical = serializeVaultSettings(pick(useSettingsStore.getState()), 1000)
  useSettingsStore.setState({ vaultSettingsLastPushedHash: vaultSettingsHash(localCanonical) })

  mockGetTreeMap.mockResolvedValue(new Map([
    ['.noteser/settings.json', 'sha-settings'],
  ]))
  mockGetBlobContent.mockResolvedValue(JSON.stringify({
    version: 1,
    updatedAt: 9999,
    vault: { folderSortMode: 'modified' },
  }))

  const { classifications } = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
    vaultSettingsPath: '.noteser/settings.json',
    vaultSettingsLocalUpdatedAt: 1000,
  })

  // Local was clean → simple update path, no conflict.
  expect(classifications.find(c => c.kind === 'vaultSettingsConflict')).toBeUndefined()
  expect(classifications.find(c => c.kind === 'vaultSettingsUpdated')).toBeDefined()
})

test('pull combines the remote .gitignore with the local overlay (gi9n UI)', async () => {
  // Remote .gitignore ignores private/; local overlay adds drafts/.
  // Both should be filtered; sibling Notes/ files unaffected.
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: 'drafts/' })

  mockGetTreeMap.mockResolvedValue(new Map([
    ['.gitignore', 'sha-gi'],
    ['private/secret.md', 'sha-secret'],  // remote-ignored
    ['drafts/wip.md', 'sha-wip'],         // overlay-ignored
    ['Notes/normal.md', 'sha-normal'],    // unaffected
  ]))
  mockGetBlobContent.mockImplementation(async (_t, _o, _n, sha: string) => {
    if (sha === 'sha-gi') return 'private/\n'
    return 'body'
  })

  const { classifications } = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
  })

  const paths = classifications
    .filter(c => c.kind === 'remoteCreated')
    .map(c => (c as { path: string }).path)
    .sort()
  expect(paths).toEqual(['Notes/normal.md'])
})

test('pull applies the default OS-junk preset when no .gitignore exists', async () => {
  // No .gitignore on remote, but a .DS_Store has snuck into the tree.
  // The .md files attached via attachments classification kind would
  // surface — we check that .DS_Store doesn't reach attachmentCreated.
  mockGetTreeMap.mockResolvedValue(new Map([
    ['attachments/.DS_Store', 'sha-ds'],
    ['attachments/diagram.png', 'sha-png'],
  ]))

  const { classifications } = await pullFromGitHub({
    provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [],
  })

  const attaches = classifications.filter(c => c.kind === 'attachmentCreated')
  const paths = attaches.map(c => (c as { path: string }).path)
  expect(paths).toContain('attachments/diagram.png')
  expect(paths).not.toContain('attachments/.DS_Store')
})

// ── pull-conflict probes ────────────────────────────────────────────────────
// Tests prompted by a user report ("If I pull it doesn't give me a conflict")
// where repro steps weren't available. These cover edge cases the existing
// tests didn't yet exercise.

test('PROBE: local DELETES a line that remote MODIFIED → must be conflict', async () => {
  const ancestor = 'line1\ntargetline\nline3'
  const localContent = 'line1\nline3' // deleted "targetline"
  const remoteContent = 'line1\ntargetline (remote)\nline3' // modified it

  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')
  mockGetBlobContent
    .mockResolvedValueOnce(remoteContent)
    .mockResolvedValueOnce(ancestor)

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: localContent, gitPath: 'Foo.md', gitLastPushedSha: 'sha-ancestor' }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })
  expect(classifications[0].kind).toBe('conflict')
})

test('PROBE: local MODIFIES a line that remote DELETED → must be conflict', async () => {
  const ancestor = 'line1\ntargetline\nline3'
  const localContent = 'line1\ntargetline (local)\nline3'
  const remoteContent = 'line1\nline3'

  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')
  mockGetBlobContent
    .mockResolvedValueOnce(remoteContent)
    .mockResolvedValueOnce(ancestor)

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: localContent, gitPath: 'Foo.md', gitLastPushedSha: 'sha-ancestor' }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })
  expect(classifications[0].kind).toBe('conflict')
})

test('PROBE: edits on CONSECUTIVE lines (no overlap) auto-merge — they should not conflict', async () => {
  const ancestor = 'line1\nline2\nline3\nline4'
  const localContent = 'line1\nLINE2-LOCAL\nline3\nline4'
  const remoteContent = 'line1\nline2\nLINE3-REMOTE\nline4'

  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')
  mockGetBlobContent
    .mockResolvedValueOnce(remoteContent)
    .mockResolvedValueOnce(ancestor)

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: localContent, gitPath: 'Foo.md', gitLastPushedSha: 'sha-ancestor' }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })
  expect(classifications[0].kind).toBe('autoMerged')
})

test('PROBE: local + remote add DIFFERENT lines at the same position → conflict', async () => {
  // Ancestor has 2 lines. Both sides insert a new line BETWEEN them, but
  // different content. The threeWayMerge "inserts at same boundary" branch
  // should detect non-identical inserts and conflict.
  const ancestor = 'top\nbottom'
  const localContent = 'top\nMIDDLE-LOCAL\nbottom'
  const remoteContent = 'top\nMIDDLE-REMOTE\nbottom'

  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')
  mockGetBlobContent
    .mockResolvedValueOnce(remoteContent)
    .mockResolvedValueOnce(ancestor)

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: localContent, gitPath: 'Foo.md', gitLastPushedSha: 'sha-ancestor' }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })
  expect(classifications[0].kind).toBe('conflict')
})

test('PROBE: ancestor blob fetch FAILS → falls through to manual conflict (not silent merge)', async () => {
  // When `getBlobContent(ancestorSha)` throws (blob GC'd, network drop),
  // the orchestrator catches and falls through to the conflict path. This
  // protects against the "auto-merged silently because we couldn't load
  // the ancestor" footgun.
  const localContent = 'whatever local'
  const remoteContent = 'whatever remote'

  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')
  mockGetBlobContent
    .mockResolvedValueOnce(remoteContent) // remote loads OK
    .mockRejectedValueOnce(new Error('ancestor blob GC\'d')) // ancestor fails

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: localContent, gitPath: 'Foo.md', gitLastPushedSha: 'sha-ancestor' }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })
  expect(classifications[0].kind).toBe('conflict')
})

// ── pull-dedupe-by-path: reconcile UNLINKED local notes ─────────────────────
// Bug: a remote `.md` whose path matches an UNLINKED local note (gitPath
// null, or stale gitPath not in the remote tree) used to be classified
// `remoteCreated` because the only match test was `n.gitPath === path`.
// apply then created a SECOND note for the same logical file (the "two Temp
// notes" twin). The fallback reconciliation below adopts the unlinked local
// note instead, routing it through the normal three-way classification and
// carrying `adoptPath` so apply can set its gitPath.

test('REGRESSION GUARD: unpushed local note whose notePath matches a remote file is adopted, NOT remoteCreated', async () => {
  // Remote has Temp.md; local has an UNPUSHED "Temp" note (gitPath null) that
  // serializes to DIFFERENT bytes than the remote (so it is not an identical
  // adopt — it exercises the three-way path). Pre-fix this is remoteCreated
  // (a duplicate). Post-fix it adopts note id '1'.
  mockGetTreeMap.mockResolvedValue(new Map([['Temp.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')   // local content hashes here
  mockGetBlobContent.mockResolvedValue('remote body')

  const local: Note[] = [
    note({ id: '1', title: 'Temp', content: 'local body', gitPath: null, gitLastPushedSha: null }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  // Must NOT be remoteCreated (that would create a duplicate note).
  expect(classifications[0].kind).not.toBe('remoteCreated')
  // Adopted note '1' — unpushed + non-identical → routed to conflict (both
  // sides carry content, no known ancestor) and tagged with adoptPath so apply
  // links its gitPath.
  expect(classifications[0]).toMatchObject({
    kind: 'conflict',
    noteId: '1',
    adoptPath: 'Temp.md',
  })
})

test('reconcile adopt: byte-identical unpushed local note → unchanged + adoptPath (no duplicate)', async () => {
  // Local content serializes to EXACTLY the remote blob SHA → the early
  // identical-content branch fires → unchanged, but carries adoptPath so apply
  // still links gitPath = Temp.md to the existing note.
  mockGetTreeMap.mockResolvedValue(new Map([['Temp.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-remote') // local hashes identical to remote

  const local: Note[] = [
    note({ id: '1', title: 'Temp', content: 'same body', gitPath: null, gitLastPushedSha: null }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toMatchObject({ kind: 'unchanged', noteId: '1', adoptPath: 'Temp.md' })
})

test('genuinely new remote file with NO local counterpart is still remoteCreated', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Temp.md', 'sha-remote']]))
  mockGetBlobContent.mockResolvedValue('hello world')

  // A local note with a DIFFERENT title (notePath = "Other.md") must not be
  // adopted for Temp.md.
  const local: Note[] = [
    note({ id: '9', title: 'Other', content: 'unrelated', gitPath: null }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  const created = classifications.filter(c => c.kind === 'remoteCreated')
  expect(created).toHaveLength(1)
  expect(created[0]).toMatchObject({ kind: 'remoteCreated', path: 'Temp.md' })
  // The unrelated local note becomes a remoteDeleted/orphan but is NEVER
  // adopted for Temp.md.
  expect(classifications.find(c => c.kind === 'remoteCreated' && (c as { adoptPath?: string }).adoptPath)).toBeUndefined()
})

test('reconcile adopt: STALE gitPath (not in remote tree) but notePath matches remote → adopt, not duplicate', async () => {
  // Note carries gitPath "Old.md" which is NOT present in the remote tree (a
  // rename happened, or a conflictDeleted respawn left a stale path). Its
  // notePath now resolves to "Temp.md", which IS the remote file. We adopt it.
  mockGetTreeMap.mockResolvedValue(new Map([['Temp.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local')
  mockGetBlobContent.mockResolvedValue('remote body')

  const local: Note[] = [
    note({ id: '1', title: 'Temp', content: 'local body', gitPath: 'Old.md', gitLastPushedSha: 'sha-old', gitRemoteBaseSha: 'sha-old' }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  // No remoteCreated for Temp.md (no twin).
  expect(classifications.find(c => c.kind === 'remoteCreated')).toBeUndefined()
  // The Temp.md walk adopts note '1' (remoteChanged: remoteBase 'sha-old' !=
  // 'sha-remote'; localChanged: 'sha-old' != 'sha-local'; no real ancestor blob
  // → conflict) and tags it with adoptPath.
  const adopted = classifications.find(c => (c as { adoptPath?: string }).adoptPath === 'Temp.md')
  expect(adopted).toBeDefined()
  expect((adopted as { noteId: string }).noteId).toBe('1')
  // The note is claimed (seenLocalIds), so the orphan pass does NOT also emit a
  // remoteDeleted for its stale Old.md path.
  expect(classifications.filter(c => c.kind === 'remoteDeleted')).toHaveLength(0)
  expect(classifications.filter(c => c.kind === 'conflictDeleted')).toHaveLength(0)
})

test('reconcile adopt is conservative when AMBIGUOUS: two unlinked notes map to the same path', async () => {
  // Two unpushed local notes both titled "Temp" → both notePath = "Temp.md".
  // Neither serializes to the remote SHA, so there is no clean SHA-based
  // tiebreak. We must NOT guess — fall back to remoteCreated.
  mockGetTreeMap.mockResolvedValue(new Map([['Temp.md', 'sha-remote']]))
  mockGitBlobSha.mockResolvedValue('sha-local') // neither matches sha-remote
  mockGetBlobContent.mockResolvedValue('remote body')

  const local: Note[] = [
    note({ id: '1', title: 'Temp', content: 'one', gitPath: null }),
    note({ id: '2', title: 'Temp', content: 'two', gitPath: null }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  // Ambiguous + no clean SHA match → remoteCreated (conservative). Neither
  // local note is adopted; they fall to the orphan pass as never-synced
  // (remoteDeleted, which just clears their stale state — here they had no
  // gitPath so they aren't touched at all).
  const created = classifications.filter(c => c.kind === 'remoteCreated')
  expect(created).toHaveLength(1)
  expect(created[0]).toMatchObject({ path: 'Temp.md' })
  // No crash, no adopt.
  expect(classifications.find(c => (c as { adoptPath?: string }).adoptPath)).toBeUndefined()
})

test('reconcile adopt resolves AMBIGUITY via clean blob-SHA match', async () => {
  // Two candidates map to Temp.md, but EXACTLY ONE serializes to the remote
  // SHA — that one is a clean identical adopt, so we take it (and skip the
  // other). This is the documented SHA-based tiebreak.
  mockGetTreeMap.mockResolvedValue(new Map([['Temp.md', 'sha-remote']]))
  // Route the SHA by content: note '2' hashes to the remote blob, note '1' does not.
  mockGitBlobSha.mockImplementation(async (content: string) => {
    if (content.includes('identical')) return 'sha-remote'
    return 'sha-other'
  })

  const local: Note[] = [
    note({ id: '1', title: 'Temp', content: 'different', gitPath: null }),
    note({ id: '2', title: 'Temp', content: 'identical', gitPath: null }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  // No duplicate created.
  expect(classifications.find(c => c.kind === 'remoteCreated')).toBeUndefined()
  // The SHA-matching note '2' is adopted as unchanged (identical content).
  const adopted = classifications.find(c => (c as { adoptPath?: string }).adoptPath === 'Temp.md')
  expect(adopted).toBeDefined()
  expect(adopted).toMatchObject({ kind: 'unchanged', noteId: '2', adoptPath: 'Temp.md' })
})

test('PROBE: identical local + remote content despite drifted ancestor → unchanged (early return)', async () => {
  // Tricky case: both sides happened to converge to the same content
  // independently. localBlobSha === remoteSha → caught by the early
  // `if (localBlobSha === remoteSha)` branch as `unchanged`, regardless
  // of lastPushed. This is correct: there's nothing to merge or conflict
  // about, the file is already in sync.
  mockGetTreeMap.mockResolvedValue(new Map([['Foo.md', 'sha-same']]))
  mockGitBlobSha.mockResolvedValue('sha-same')
  // No getBlobContent calls expected — early-return short-circuits.

  const local: Note[] = [
    note({ id: '1', title: 'Foo', content: 'same content', gitPath: 'Foo.md', gitLastPushedSha: 'sha-ancestor' }),
  ]
  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })
  expect(classifications[0].kind).toBe('unchanged')
})

// ── foreign vault files (.canvas / .base / etc.) ────────────────────────────
//
// Non-md, non-attachment files we cannot render yet. The pull emits a
// `foreignFile` classification per remote file so the apply layer can mirror
// each one as an un-openable entry in the sidebar tree.

test('classifies a remote .canvas file with no local match as foreignFile', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Untitled.canvas', 'sha-canvas']]))

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [] })

  // Exactly one classification, exactly the foreignFile entry — no body fetch.
  const foreign = classifications.filter(c => c.kind === 'foreignFile')
  expect(foreign).toHaveLength(1)
  expect(foreign[0]).toEqual({ kind: 'foreignFile', path: 'Untitled.canvas', remoteSha: 'sha-canvas' })
  expect(mockGetBlobContent).not.toHaveBeenCalled()
})

test('classifies both a .canvas and a .base remote file as foreignFile', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([
    ['Untitled.canvas', 'sha-canvas'],
    ['Untitled.base', 'sha-base'],
  ]))

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [] })

  const foreign = classifications.filter(c => c.kind === 'foreignFile')
  expect(foreign).toHaveLength(2)
  const byPath = new Map(foreign.map(f => [(f as { path: string }).path, f]))
  expect(byPath.get('Untitled.canvas')).toEqual({ kind: 'foreignFile', path: 'Untitled.canvas', remoteSha: 'sha-canvas' })
  expect(byPath.get('Untitled.base')).toEqual({ kind: 'foreignFile', path: 'Untitled.base', remoteSha: 'sha-base' })
})

test('does not re-emit foreignFile when a local foreign note already mirrors the path', async () => {
  mockGetTreeMap.mockResolvedValue(new Map([['Untitled.canvas', 'sha-canvas']]))

  // Local already has a foreign mirror for this exact path (a prior pull).
  const local: Note[] = [
    note({
      id: '1',
      title: 'Untitled.canvas',
      content: '',
      gitPath: 'Untitled.canvas',
      gitLastPushedSha: 'sha-canvas',
      gitRemoteBaseSha: 'sha-canvas',
    } as Note & { kind: 'foreign' }),
  ]
  // Tag it as foreign — note() helper doesn't expose `kind` directly.
  ;(local[0] as { kind?: string }).kind = 'foreign'

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  expect(classifications.find(c => c.kind === 'foreignFile')).toBeUndefined()
})

test('local foreign mirror whose remote file is gone classifies as remoteDeleted (no content hashing)', async () => {
  mockGetTreeMap.mockResolvedValue(new Map())
  // gitBlobSha should NOT be called for the foreign-shortcut path — keep the
  // mock implementation strict so an unexpected call would explode visibly.
  mockGitBlobSha.mockImplementation(() => { throw new Error('foreign branch should not hash content') })

  const local: Note[] = [
    note({
      id: '1',
      title: 'Untitled.canvas',
      content: '',
      gitPath: 'Untitled.canvas',
      gitLastPushedSha: 'sha-canvas',
      gitRemoteBaseSha: 'sha-canvas',
    }),
  ]
  ;(local[0] as { kind?: string }).kind = 'foreign'

  const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: local, folders: [] })

  expect(classifications).toHaveLength(1)
  expect(classifications[0]).toEqual({ kind: 'remoteDeleted', noteId: '1' })
})

test('non-md non-attachment file under an ignored path does NOT classify as foreignFile', async () => {
  // The default gitignore matcher drops `.DS_Store` and *.tmp. Drop a
  // .canvas alongside one of those in an ignored subtree and confirm the
  // gitignore wins (the matcher gate runs BEFORE the foreign check).
  // Note: the default ignore set doesn't currently cover .canvas in any
  // path, so we use the per-device overlay (settingsStore) to ignore a
  // specific name and assert it gets filtered out.
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: 'ignored.canvas' })
  try {
    mockGetTreeMap.mockResolvedValue(new Map([
      ['Untitled.canvas', 'sha-canvas'],
      ['ignored.canvas',  'sha-ignored'],
    ]))

    const { classifications } = await pullFromGitHub({ provider: new GitHubProvider('t'), repo: REPO, notes: [], folders: [] })

    const foreign = classifications.filter(c => c.kind === 'foreignFile')
    expect(foreign).toHaveLength(1)
    expect((foreign[0] as { path: string }).path).toBe('Untitled.canvas')
  } finally {
    useSettingsStore.setState({ localGitignoreOverlay: '' })
  }
})
