/**
 * @jest-environment node
 *
 * progressiveClone.test.ts
 *
 * Unit coverage for the progressive first-clone (shell) feature:
 *   1. SHELL creation (applyNonConflicts on a shell remoteCreated) sets the
 *      right fields: content '', contentLoaded false, gitLastPushedSha AND
 *      gitRemoteBaseSha === the RAW remote blob SHA.
 *   2. The pull classifier returns `unchanged` for a shell WITHOUT fetching
 *      the blob (getBlobContent is never called for it) — the core safety
 *      guard.
 *   3. Background fill patches content + canonical-local SHA + contentLoaded.
 *   4. search.initializeSearch and tags.collectAllTags EXCLUDE shells.
 *   5. A shell never produces a push entry (syncToGitHub emits no tree entry /
 *      no commit for an unfilled shell — no empty-body overwrite).
 *
 * Strategy mirrors githubSyncClassify.test.ts: mock the github.ts network
 * surface, keep gitBlobSha / gitBlobShaBytes REAL so the canonical-SHA
 * assertions are meaningful. idb-keyval is an in-memory map for the Zustand
 * persist + attachments layers.
 */

// ── idb-keyval mock (Zustand persist + attachments) ─────────────────────────
jest.mock('idb-keyval', () => {
  const store = new Map<IDBValidKey, unknown>()
  return {
    get: jest.fn(async (key: IDBValidKey) => store.get(key)),
    set: jest.fn(async (key: IDBValidKey, val: unknown) => { store.set(key, val) }),
    del: jest.fn(async (key: IDBValidKey) => { store.delete(key) }),
    keys: jest.fn(async () => Array.from(store.keys())),
    clear: jest.fn(async () => { store.clear() }),
  }
})

// Attachments: text-only here — stub the binary surface.
jest.mock('../utils/attachments', () => ({
  isAttachmentPath: () => false,
  listAttachmentPaths: async () => [],
  getAttachmentBlob: async () => null,
  getAttachmentGitSha: async () => null,
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
const mockRefreshAccessToken = jest.fn()

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
    refreshAccessToken: (...a: unknown[]) => mockRefreshAccessToken(...a),
    // gitBlobSha + gitBlobShaBytes + getBlobBytes come through REAL via spread.
  }
})

import { pullFromGitHub, syncToGitHub, serializeNote } from '../utils/githubSync'
import { gitBlobSha as realGitBlobSha } from '../utils/github'
import { applyNonConflicts } from '../utils/syncApply'
import { fillShellsInBackground, ensureNoteBodyLoaded, _resetFillInFlight } from '../utils/backgroundFill'
import { GitHubAPIError } from '../utils/github'
import { _resetInFlightRefresh } from '../utils/tokenRefresh'
import { initializeSearch, searchNotes } from '../utils/search'
import { collectAllTags } from '../utils/tags'
import { useNoteStore } from '../stores/noteStore'
import { useGitHubStore } from '../stores/githubStore'
import type { Note, SyncRepo } from '@/types'
import type { PullClassification as Classification } from '../utils/githubSync'

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
    contentLoaded: input.contentLoaded,
  } as Note
}

beforeEach(async () => {
  jest.clearAllMocks()
  _resetFillInFlight()
  _resetInFlightRefresh()
  mockGetBranchRefSha.mockResolvedValue('headsha')
  mockGetCommitTreeSha.mockResolvedValue('treesha')
  // Reset stores to empty between tests. Refresh fields are explicitly
  // nulled so the default session reads as non-expiring (PAT-style) and the
  // token-refresh layer passes 'tok' through verbatim.
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useGitHubStore.setState({
    token: 'tok', syncRepo: REPO,
    accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null,
  } as Partial<ReturnType<typeof useGitHubStore.getState>>)
  const { useSettingsStore } = await import('../stores/settingsStore')
  useSettingsStore.setState({ localGitignoreOverlay: '' })
})

// ── 1. SHELL creation ────────────────────────────────────────────────────────
describe('shell creation (applyNonConflicts)', () => {
  test('a shell remoteCreated materialises content "", contentLoaded false, both SHAs = remote blob SHA', async () => {
    const REMOTE_SHA = 'a'.repeat(40)
    const classifications: Classification[] = [
      { kind: 'remoteCreated', path: 'Inbox/Hello.md', remoteSha: REMOTE_SHA, remoteContent: '', tags: [], body: '', shell: true },
    ]
    const counts = await applyNonConflicts(classifications)
    expect(counts.created).toBe(1)

    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    const n = notes[0]
    expect(n.title).toBe('Hello')
    expect(n.gitPath).toBe('Inbox/Hello.md')
    expect(n.content).toBe('')
    expect(n.contentLoaded).toBe(false)
    // CRITICAL: both SHAs pinned to the RAW remote blob sha (NOT canonical-of-empty).
    expect(n.gitLastPushedSha).toBe(REMOTE_SHA)
    expect(n.gitRemoteBaseSha).toBe(REMOTE_SHA)
    // Sanity: the empty-body canonical SHA differs from the remote SHA — proving
    // we did NOT use canonicalLocalSha('') here (which would be the bug).
    const emptyCanonical = await realGitBlobSha(serializeNote({ content: '' } as Note))
    expect(n.gitLastPushedSha).not.toBe(emptyCanonical)
  })

  test('a NORMAL (non-shell) remoteCreated sets contentLoaded true with the real body', async () => {
    const REMOTE_SHA = 'b'.repeat(40)
    const classifications: Classification[] = [
      { kind: 'remoteCreated', path: 'Note.md', remoteSha: REMOTE_SHA, remoteContent: 'Body here\n', tags: [], body: 'Body here\n' },
    ]
    await applyNonConflicts(classifications)
    const n = useNoteStore.getState().notes[0]
    expect(n.contentLoaded).toBe(true)
    expect(n.content).toBe('Body here\n')
    // Normal note: gitLastPushedSha is the canonical-local SHA, NOT the raw remote.
    const canonical = await realGitBlobSha(serializeNote({ content: 'Body here\n' } as Note))
    expect(n.gitLastPushedSha).toBe(canonical)
    expect(n.gitRemoteBaseSha).toBe(REMOTE_SHA)
  })
})

// ── 2. Classifier guard ──────────────────────────────────────────────────────
describe('classifier guard: a shell classifies unchanged WITHOUT fetching its blob', () => {
  test('matched local shell → unchanged, getBlobContent never called for it', async () => {
    const REMOTE_SHA = 'c'.repeat(40)
    // Remote tree has the file at the shell's path with a DIFFERENT-from-empty sha.
    mockGetTreeMap.mockResolvedValue(new Map<string, string>([['Shell.md', REMOTE_SHA]]))
    // If the guard is broken and the classifier falls through, it would call
    // getBlobContent — make that observable (and return a body so we'd see a
    // remoteUpdated/conflict instead of the expected unchanged).
    mockGetBlobContent.mockResolvedValue('SOME REMOTE BODY\n')

    const shell = note({
      id: 's1', title: 'Shell', gitPath: 'Shell.md',
      content: '', contentLoaded: false,
      gitLastPushedSha: REMOTE_SHA, gitRemoteBaseSha: REMOTE_SHA,
    })

    const { classifications } = await pullFromGitHub({
      token: 'tok', repo: REPO, notes: [shell], folders: [],
    })

    const mine = classifications.filter(c => 'noteId' in c && (c as { noteId: string }).noteId === 's1')
    expect(mine).toHaveLength(1)
    expect(mine[0].kind).toBe('unchanged')
    // The guard short-circuits BEFORE any blob fetch for this note.
    expect(mockGetBlobContent).not.toHaveBeenCalledWith('tok', REPO.owner, REPO.name, REMOTE_SHA)
  })

  test('guard holds even when the remote blob SHA differs from the shell SHAs', async () => {
    // Simulate a shell whose recorded SHAs are stale vs the current remote
    // (e.g. remote changed before the body ever loaded). The guard must STILL
    // classify unchanged — never remoteUpdated — because the local body is a
    // placeholder we cannot three-way merge.
    const SHELL_SHA = 'd'.repeat(40)
    const NEW_REMOTE_SHA = 'e'.repeat(40)
    mockGetTreeMap.mockResolvedValue(new Map<string, string>([['Drift.md', NEW_REMOTE_SHA]]))
    mockGetBlobContent.mockResolvedValue('NEW BODY\n')

    const shell = note({
      id: 's2', title: 'Drift', gitPath: 'Drift.md',
      content: '', contentLoaded: false,
      gitLastPushedSha: SHELL_SHA, gitRemoteBaseSha: SHELL_SHA,
    })
    const { classifications } = await pullFromGitHub({ token: 'tok', repo: REPO, notes: [shell], folders: [] })
    const mine = classifications.filter(c => 'noteId' in c && (c as { noteId: string }).noteId === 's2')
    expect(mine).toHaveLength(1)
    expect(mine[0].kind).toBe('unchanged')
  })
})

// ── 3. Background fill ────────────────────────────────────────────────────────
describe('background fill patches content + canonical SHA + contentLoaded', () => {
  test('fillShellsInBackground loads each shell body and re-pins gitLastPushedSha', async () => {
    const REMOTE_SHA = 'f'.repeat(40)
    const BODY = 'The real body with #atag\n'
    mockGetBlobContent.mockResolvedValue(BODY)

    useNoteStore.setState({
      notes: [note({
        id: 's3', title: 'Fillme', gitPath: 'Fillme.md',
        content: '', contentLoaded: false,
        gitLastPushedSha: REMOTE_SHA, gitRemoteBaseSha: REMOTE_SHA,
      })],
      selectedNoteId: null,
    })

    await fillShellsInBackground()

    const n = useNoteStore.getState().notes[0]
    expect(n.contentLoaded).toBe(true)
    expect(n.content).toBe(BODY)
    // gitLastPushedSha re-pinned to the canonical-local SHA so the next pull
    // reads it as unchanged.
    const canonical = await realGitBlobSha(serializeNote({ content: BODY } as Note))
    expect(n.gitLastPushedSha).toBe(canonical)
    // gitRemoteBaseSha stays the raw remote blob SHA (the merge ancestor).
    expect(n.gitRemoteBaseSha).toBe(REMOTE_SHA)
    // The body was fetched from the recorded remote SHA exactly once.
    expect(mockGetBlobContent).toHaveBeenCalledWith('tok', REPO.owner, REPO.name, REMOTE_SHA)
  })

  test('ensureNoteBodyLoaded fills a single shell on open', async () => {
    const REMOTE_SHA = '0'.repeat(40)
    mockGetBlobContent.mockResolvedValue('Opened body\n')
    useNoteStore.setState({
      notes: [note({
        id: 's4', title: 'Open', gitPath: 'Open.md',
        content: '', contentLoaded: false,
        gitLastPushedSha: REMOTE_SHA, gitRemoteBaseSha: REMOTE_SHA,
      })],
      selectedNoteId: 's4',
    })
    await ensureNoteBodyLoaded('s4')
    const n = useNoteStore.getState().notes[0]
    expect(n.contentLoaded).toBe(true)
    expect(n.content).toBe('Opened body\n')
  })

  test('fill is a no-op when there are no shells', async () => {
    useNoteStore.setState({
      notes: [note({ id: 'plain', title: 'Plain', content: 'x\n', contentLoaded: true })],
      selectedNoteId: null,
    })
    await fillShellsInBackground()
    expect(mockGetBlobContent).not.toHaveBeenCalled()
  })

  test('a 401 on the blob read refreshes the token once and retries (fill no longer strands shells)', async () => {
    // Expiring-token session with comfortable headroom, so the FIRST attempt
    // uses the stored token and only the reactive 401 path triggers a refresh.
    useGitHubStore.setState({
      token: 'gho_stale', syncRepo: REPO,
      accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
      refreshToken: 'ghr_refresh',
      refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    } as Partial<ReturnType<typeof useGitHubStore.getState>>)
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: 'gho_rotated',
      accessTokenExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
      refreshToken: 'ghr_rotated',
      refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
    mockGetBlobContent
      .mockImplementationOnce(async () => {
        throw new GitHubAPIError(401, 'Read blob', 'Bad credentials', null, null)
      })
      .mockResolvedValue('Recovered body\n')

    const REMOTE_SHA = '1'.repeat(40)
    useNoteStore.setState({
      notes: [note({
        id: 's401', title: 'Stale', gitPath: 'Stale.md',
        content: '', contentLoaded: false,
        gitLastPushedSha: REMOTE_SHA, gitRemoteBaseSha: REMOTE_SHA,
      })],
      selectedNoteId: null,
    })

    await fillShellsInBackground()

    const n = useNoteStore.getState().notes[0]
    expect(n.contentLoaded).toBe(true)
    expect(n.content).toBe('Recovered body\n')
    // Exactly one refresh; the retry used the rotated token.
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)
    expect(mockGetBlobContent).toHaveBeenLastCalledWith('gho_rotated', REPO.owner, REPO.name, REMOTE_SHA)
  })

  test('renewal exhaustion leaves the shell unloaded (silent retry-later, no throw)', async () => {
    // Non-refreshable (PAT-style) session whose blob reads 401 — the fill
    // must swallow the ReconnectRequiredError and leave the shell intact.
    mockGetBlobContent.mockImplementation(async () => {
      throw new GitHubAPIError(401, 'Read blob', 'Bad credentials', null, null)
    })
    const REMOTE_SHA = '2'.repeat(40)
    useNoteStore.setState({
      notes: [note({
        id: 'spat', title: 'Pat', gitPath: 'Pat.md',
        content: '', contentLoaded: false,
        gitLastPushedSha: REMOTE_SHA, gitRemoteBaseSha: REMOTE_SHA,
      })],
      selectedNoteId: null,
    })

    await expect(fillShellsInBackground()).resolves.toBeUndefined()

    const n = useNoteStore.getState().notes[0]
    expect(n.contentLoaded).toBe(false) // still a shell — retried later
    expect(mockRefreshAccessToken).not.toHaveBeenCalled()
  })
})

// ── 4. Search + tags exclude shells ──────────────────────────────────────────
describe('search and tags exclude shells', () => {
  test('initializeSearch does not index a shell body', () => {
    const shell = note({ id: 'sh', title: 'Findme', content: '', contentLoaded: false })
    const loaded = note({ id: 'ld', title: 'Other', content: 'Findme keyword here', contentLoaded: true })
    initializeSearch([shell, loaded])
    // Searching the shell's TITLE should not return it while it is a shell.
    const results = searchNotes([shell, loaded], 'Findme')
    const ids = results.map(r => r.noteId)
    expect(ids).not.toContain('sh')
  })

  test('collectAllTags skips shells, includes them once loaded', () => {
    const shell = note({ id: 'sh', title: 'S', content: '#secret tag in body', contentLoaded: false })
    const loaded = note({ id: 'ld', title: 'L', content: '#visible tag', contentLoaded: true })
    const before = collectAllTags([shell, loaded])
    expect(before.has('visible')).toBe(true)
    expect(before.has('secret')).toBe(false)

    // Once the shell loads (contentLoaded true), its tags appear.
    const loadedShell = { ...shell, contentLoaded: true }
    const after = collectAllTags([loadedShell, loaded])
    expect(after.has('secret')).toBe(true)
  })
})

// ── 5. A shell never produces a push entry ────────────────────────────────────
describe('syncToGitHub never pushes an unfilled shell', () => {
  test('a vault of only shells produces NO tree entry and NO commit', async () => {
    const REMOTE_SHA = '1'.repeat(40)
    // Remote tree already has the shell's file. If the push wrongly considered
    // the shell, it would compute an empty-blob localSha != REMOTE_SHA and try
    // to upload + commit. We assert it does none of that.
    mockGetTreeMap.mockResolvedValue(new Map<string, string>([['Shelly.md', REMOTE_SHA]]))

    const shell = note({
      id: 'p1', title: 'Shelly', gitPath: 'Shelly.md',
      content: '', contentLoaded: false,
      gitLastPushedSha: REMOTE_SHA, gitRemoteBaseSha: REMOTE_SHA,
    })

    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [shell], folders: [] })

    // No blob upload, no tree, no commit, no ref update.
    expect(mockCreateBlob).not.toHaveBeenCalled()
    expect(mockCreateTree).not.toHaveBeenCalled()
    expect(mockCreateCommit).not.toHaveBeenCalled()
    expect(mockUpdateBranchRef).not.toHaveBeenCalled()
    expect(outcome.result.unchanged).toBe(true)
    expect(outcome.result.created).toBe(0)
    expect(outcome.result.updated).toBe(0)
    expect(outcome.result.deleted).toBe(0)
    // And no delete of the real remote file (the other empty-body hazard).
    expect(outcome.pathUpdates.find(u => u.noteId === 'p1' && u.gitPath === null)).toBeUndefined()
  })

  test('once the shell is filled, a normal edit pushes as usual', async () => {
    const REMOTE_SHA = '2'.repeat(40)
    // After fill: contentLoaded true, edited body that differs from remote.
    mockGetTreeMap.mockResolvedValue(new Map<string, string>([['Filled.md', REMOTE_SHA]]))
    mockCreateBlob.mockResolvedValue('newblobsha')
    mockCreateTree.mockResolvedValue('newtreesha')
    mockCreateCommit.mockResolvedValue({ sha: 'newcommit', html_url: 'http://x' })
    mockUpdateBranchRef.mockResolvedValue(undefined)

    const filled = note({
      id: 'p2', title: 'Filled', gitPath: 'Filled.md',
      content: 'Edited body now\n', contentLoaded: true,
      gitLastPushedSha: 'oldcanonical', gitRemoteBaseSha: REMOTE_SHA,
    })
    const outcome = await syncToGitHub({ token: 'tok', repo: REPO, notes: [filled], folders: [] })
    expect(mockCreateBlob).toHaveBeenCalled()
    expect(mockCreateCommit).toHaveBeenCalled()
    expect(outcome.result.unchanged).toBe(false)
    expect(outcome.result.updated).toBe(1)
  })
})
