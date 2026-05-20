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

  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

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

  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: [], folders: [] })

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

  const { classifications } = await pullFromGitHub({ token: 't', repo: REPO, notes: local, folders: [] })

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
    token: 't', repo: REPO, notes: [], folders: [],
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
    token: 't', repo: REPO, notes: [], folders: [],
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
    token: 't', repo: REPO, notes: [], folders: [],
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
    token: 't', repo: REPO, notes: [], folders: [],
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
    token: 't', repo: REPO, notes: [], folders: [],
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
    token: 't', repo: REPO, notes: [], folders: [],
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
    token: 't', repo: REPO, notes: [], folders: [],
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
    token: 't', repo: REPO, notes: [], folders: [],
  })

  const attaches = classifications.filter(c => c.kind === 'attachmentCreated')
  const paths = attaches.map(c => (c as { path: string }).path)
  expect(paths).toContain('attachments/diagram.png')
  expect(paths).not.toContain('attachments/.DS_Store')
})
