/**
 * @jest-environment node
 *
 * Tests revertToCommit's mutation of the noteStore against a mocked
 * GitHub API. The util is the load-bearing piece of the
 * revert-to-commit feature — the modal is a thin wrapper around it.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// Stub the github helpers so the util's network calls are deterministic.
// refreshAccessToken is mocked too so the token-refresh wrapper around the
// revert reads can be exercised without touching the proxy/network.
const mockGetCommitTreeSha = jest.fn()
const mockGetTreeMap = jest.fn()
const mockGetBlobContent = jest.fn()
const mockRefreshAccessToken = jest.fn()
jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github') as typeof import('../utils/github')
  return {
    ...actual,
    getCommitTreeSha: (...a: unknown[]) => mockGetCommitTreeSha(...a),
    getTreeMap: (...a: unknown[]) => mockGetTreeMap(...a),
    getBlobContent: (...a: unknown[]) => mockGetBlobContent(...a),
    refreshAccessToken: (...a: unknown[]) => mockRefreshAccessToken(...a),
  }
})

import { revertToCommit } from '../utils/revertToCommit'
import { useNoteStore } from '../stores/noteStore'
import { useGitHubStore, type GitHubTokenSet } from '../stores/githubStore'
import { GitHubAPIError } from '../utils/github'
import { ReconnectRequiredError, _resetInFlightRefresh } from '../utils/tokenRefresh'
import type { Note } from '../types'

const USER = { login: 'octocat', avatar_url: '', name: null, id: 1 }

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? `note-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title ?? 'Note',
    content: overrides.content ?? '',
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
    gitPath: null,
    gitLastPushedSha: null,
    ...overrides,
  }
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  mockGetCommitTreeSha.mockReset()
  mockGetTreeMap.mockReset()
  mockGetBlobContent.mockReset()
  mockRefreshAccessToken.mockReset()
  _resetInFlightRefresh()
  // Default: a connected, comfortably-valid expiring session so the
  // withTokenRefresh wrapper hands the revert a usable token without
  // triggering a refresh. Individual tests override for the 401 paths.
  useGitHubStore.getState().disconnect()
  useGitHubStore.getState().setSession('gho_access', USER, ['repo'], {
    accessToken: 'gho_access',
    accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    refreshToken: 'ghr_refresh',
    refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })
})

describe('revertToCommit', () => {
  it('rewrites a pushed note when the historical tree has the same path', async () => {
    seedNote(makeNote({ id: 'n1', gitPath: 'notes/hello.md', content: 'current body' }))
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([['notes/hello.md', 'blob-xyz']]))
    mockGetBlobContent.mockResolvedValue('historical body')

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-abc',
    })

    expect(result.replaced).toBe(1)
    expect(result.created).toBe(0)
    expect(result.removed).toBe(0)

    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toBe('historical body')
    expect(notes[0].gitPath).toBe('notes/hello.md')
    // gitLastPushedSha must be cleared so the next push actually
    // re-uploads the rewritten content.
    expect(notes[0].gitLastPushedSha).toBeNull()
  })

  it('creates a new note when the historical tree has a path we lack locally', async () => {
    // No local notes.
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([['lost/file.md', 'blob-1']]))
    mockGetBlobContent.mockResolvedValue('I came back from the dead')

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    expect(result.replaced).toBe(0)
    expect(result.created).toBe(1)

    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].gitPath).toBe('lost/file.md')
    expect(notes[0].content).toBe('I came back from the dead')
    // Title derived from the filename.
    expect(notes[0].title).toBe('file')
  })

  it('soft-deletes a pushed note that is not in the historical tree', async () => {
    seedNote(makeNote({ id: 'gone', gitPath: 'notes/gone.md' }))
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    // Empty tree — the historical commit didn't have this file.
    mockGetTreeMap.mockResolvedValue(new Map())

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-empty',
    })

    expect(result.removed).toBe(1)

    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(1)
    expect(notes[0].isDeleted).toBe(true)
    expect(notes[0].deletedAt).not.toBeNull()
  })

  it('preserves unpushed local notes (no gitPath) verbatim', async () => {
    seedNote(makeNote({ id: 'draft', gitPath: null, content: 'I am a draft' }))
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map())

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    expect(result.preservedUnpushed).toBe(1)
    expect(result.removed).toBe(0)

    const draft = useNoteStore.getState().notes.find(n => n.id === 'draft')!
    expect(draft).toBeDefined()
    expect(draft.isDeleted).toBe(false)
    expect(draft.content).toBe('I am a draft')
  })

  it('ignores non-.md files in the historical tree', async () => {
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([
      ['notes/markdown.md', 'blob-md'],
      ['attachments/image.png', 'blob-img'],
      ['README', 'blob-txt'],
    ]))
    mockGetBlobContent.mockResolvedValue('markdown body')

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    // Only the .md file became a note.
    expect(result.created).toBe(1)
    expect(useNoteStore.getState().notes).toHaveLength(1)
    // We didn't fetch the binary/non-md blobs.
    expect(mockGetBlobContent).toHaveBeenCalledTimes(1)
  })

  it('strips frontmatter into inline tags (uses parseNote pipeline)', async () => {
    seedNote(makeNote({ id: 'n1', gitPath: 'notes/x.md', content: 'current' }))
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([['notes/x.md', 'blob']]))
    mockGetBlobContent.mockResolvedValue('---\ntags: [a, b]\n---\nactual body')

    await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    const restored = useNoteStore.getState().notes[0]
    // bodyWithInlineTags stamps the tag line in front of the body.
    expect(restored.content).toContain('#a')
    expect(restored.content).toContain('#b')
    expect(restored.content).toContain('actual body')
  })
})

describe('revertToCommit — parallel blob fetch', () => {
  it('fetches blobs with bounded concurrency (≤8 in flight) and completes correctly', async () => {
    // 25 markdown files in the historical tree.
    const tree = new Map<string, string>()
    for (let i = 0; i < 25; i++) tree.set(`notes/n${i}.md`, `blob-${i}`)
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(tree)

    let inFlight = 0
    let maxInFlight = 0
    mockGetBlobContent.mockImplementation(async (_t, _o, _r, sha: string) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 3))
      inFlight--
      // Content keyed off the blob sha so we can verify the path→content map.
      return `body-for-${sha}`
    })

    const result = await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    // Every file became a new note (no local notes seeded).
    expect(result.created).toBe(25)
    // Concurrency was actually bounded at the default cap of 8 …
    expect(maxInFlight).toBeLessThanOrEqual(8)
    // … and it actually parallelised (sequential would peak at 1).
    expect(maxInFlight).toBeGreaterThan(1)
    expect(mockGetBlobContent).toHaveBeenCalledTimes(25)

    // Result is COMPLETE and CORRECT: every path's content matches its blob.
    const notes = useNoteStore.getState().notes
    expect(notes).toHaveLength(25)
    for (let i = 0; i < 25; i++) {
      const n = notes.find((x) => x.gitPath === `notes/n${i}.md`)!
      expect(n).toBeDefined()
      expect(n.content).toBe(`body-for-blob-${i}`)
    }
  })

  it('reports progress to the onBlobProgress callback (fetched/total)', async () => {
    const tree = new Map<string, string>([
      ['notes/a.md', 'blob-a'],
      ['notes/b.md', 'blob-b'],
      ['notes/c.md', 'blob-c'],
    ])
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(tree)
    mockGetBlobContent.mockResolvedValue('body')

    const progress: Array<[number, number]> = []
    await revertToCommit({
      token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x',
      onBlobProgress: (fetched, total) => progress.push([fetched, total]),
    })

    // Total is constant; fetched starts at 0 and ends at the total.
    expect(progress.every(([, total]) => total === 3)).toBe(true)
    expect(progress[0]).toEqual([0, 3])
    expect(progress[progress.length - 1]).toEqual([3, 3])
  })

  it('surfaces a mid-batch blob failure cleanly (rejects, does not partially apply)', async () => {
    const tree = new Map<string, string>([
      ['notes/a.md', 'blob-a'],
      ['notes/b.md', 'blob-b'],
      ['notes/c.md', 'blob-c'],
    ])
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(tree)
    mockGetBlobContent.mockImplementation(async (_t, _o, _r, sha: string) => {
      if (sha === 'blob-b') throw new Error('blob fetch boom')
      return 'body'
    })

    await expect(
      revertToCommit({ token: 't', owner: 'o', repo: 'r', commitSha: 'commit-x' }),
    ).rejects.toThrow('blob fetch boom')

    // The store was NOT mutated — the failure happens before the setState.
    expect(useNoteStore.getState().notes).toHaveLength(0)
  })
})

describe('revertToCommit — token refresh on the read path', () => {
  function setNearExpirySession() {
    useGitHubStore.getState().disconnect()
    useGitHubStore.getState().setSession('gho_access', USER, ['repo'], {
      accessToken: 'gho_access',
      accessTokenExpiresAt: Date.now() + 1_000, // within skew → wants refresh
      refreshToken: 'ghr_refresh',
      refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
  }

  const rotated: GitHubTokenSet = {
    accessToken: 'gho_rotated',
    accessTokenExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
    refreshToken: 'ghr_rotated',
    refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  }

  it('refreshes-and-retries when a read 401s, then succeeds with the fresh token', async () => {
    // Comfortable session so the first attempt uses the stored token.
    mockGetCommitTreeSha
      .mockImplementationOnce(async () => {
        throw new GitHubAPIError(401, 'Read commit', 'Bad credentials', null, null)
      })
      .mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([['notes/x.md', 'blob-x']]))
    mockGetBlobContent.mockResolvedValue('recovered body')
    mockRefreshAccessToken.mockResolvedValue(rotated)

    const result = await revertToCommit({
      token: 'gho_access', owner: 'o', repo: 'r', commitSha: 'commit-x',
    })

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)
    expect(result.created).toBe(1)
    // The retry used the rotated token (proves the closure re-ran with it).
    expect(mockGetCommitTreeSha).toHaveBeenLastCalledWith('gho_rotated', 'o', 'r', 'commit-x')
    expect(useGitHubStore.getState().token).toBe('gho_rotated')
  })

  it('proactively refreshes a near-expiry token before the read', async () => {
    setNearExpirySession()
    mockRefreshAccessToken.mockResolvedValue(rotated)
    mockGetCommitTreeSha.mockResolvedValue('tree-abc')
    mockGetTreeMap.mockResolvedValue(new Map([['notes/x.md', 'blob-x']]))
    mockGetBlobContent.mockResolvedValue('body')

    await revertToCommit({ token: 'stale', owner: 'o', repo: 'r', commitSha: 'commit-x' })

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)
    // The very first read already used the rotated token.
    expect(mockGetCommitTreeSha).toHaveBeenCalledWith('gho_rotated', 'o', 'r', 'commit-x')
  })

  it('surfaces ReconnectRequiredError when the refresh is exhausted (two consecutive 401s)', async () => {
    mockGetCommitTreeSha.mockImplementation(async () => {
      throw new GitHubAPIError(401, 'Read commit', 'Bad credentials', null, null)
    })
    mockRefreshAccessToken.mockResolvedValue(rotated)

    await expect(
      revertToCommit({ token: 'gho_access', owner: 'o', repo: 'r', commitSha: 'commit-x' }),
    ).rejects.toBeInstanceOf(ReconnectRequiredError)

    // Exactly one refresh, never loops.
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)
  })

  it('a PAT 401 surfaces ReconnectRequiredError with NO refresh attempt', async () => {
    // PAT / classic: no refresh fields → never refreshable.
    useGitHubStore.getState().disconnect()
    useGitHubStore.getState().setSession('github_pat_xyz', USER, null)
    mockGetCommitTreeSha.mockImplementation(async () => {
      throw new GitHubAPIError(401, 'Read commit', 'Bad credentials', null, null)
    })

    await expect(
      revertToCommit({ token: 'github_pat_xyz', owner: 'o', repo: 'r', commitSha: 'commit-x' }),
    ).rejects.toBeInstanceOf(ReconnectRequiredError)
    expect(mockRefreshAccessToken).not.toHaveBeenCalled()
  })
})

function seedNote(n: Note) {
  useNoteStore.setState({ notes: [...useNoteStore.getState().notes, n] })
}
