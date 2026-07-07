/**
 * @jest-environment node
 *
 * GitHubProvider is the GitHub implementation of the GitHostProvider seam
 * (docs/multi-host-sync-plan.md). It is a thin wrap of the existing
 * functions in `utils/github.ts`: it must DELEGATE rather than reimplement
 * any HTTP. These tests mock the github.ts module and assert:
 *
 *   - each method forwards to the matching github.ts function with the
 *     token bound at construction and the SyncRepo mapped onto its
 *     positional (token, owner, repo, ...) args,
 *   - repo/branch shapes are mapped onto HostRepo / string[],
 *   - commitChanges performs the blob → tree → commit → ref sequence for a
 *     mixed create/update/delete batch (deletes = sha:null tree entries,
 *     binary uses createBlobBinary, base tree resolved from parentSha).
 */

import type { SyncRepo, GitHubRepo } from '@/types'

jest.mock('../utils/github', () => ({
  getBranchRefSha: jest.fn(),
  getCommitTreeSha: jest.fn(),
  getTreeMap: jest.fn(),
  getBlobContent: jest.fn(),
  getBlobBytes: jest.fn(),
  fetchGitHubUser: jest.fn(),
  listUserRepos: jest.fn(),
  listRepoBranches: jest.fn(),
  getRepo: jest.fn(),
  createRepo: jest.fn(),
  createBlob: jest.fn(),
  createBlobBinary: jest.fn(),
  createTree: jest.fn(),
  createCommit: jest.fn(),
  updateBranchRef: jest.fn(),
  // commitChanges computes content-addressable blob SHAs locally to key its
  // upload cache and to compare against the parent tree. Stubbed to a
  // content-derived string so distinct content yields distinct cache keys.
  gitBlobSha: jest.fn(async (content: string) => `sha:${content}`),
  gitBlobShaBytes: jest.fn(
    async (bytes: Uint8Array) => `sha-bytes:${bytes.length}`
  )
}))

// The *Cached read variants delegate to the #69 ETag-conditional wrappers
// (used by the PULL path); the plain getTreeMap/getBlobContent above are for
// PUSH. Mock both so we can assert the split.
jest.mock('../utils/githubETagCache', () => ({
  getTreeMapConditional: jest.fn(),
  getBlobContentConditional: jest.fn()
}))

import * as github from '../utils/github'
import { fetchGitHubUser } from '../utils/github'
import * as etagCache from '../utils/githubETagCache'
import {
  GitHubProvider,
  _resetUploadedShaCache
} from '../utils/gitHost/githubProvider'

const mock = github as jest.Mocked<typeof github>
const etagMock = etagCache as jest.Mocked<typeof etagCache>

const TOKEN = 'tok-123'
const REPO: SyncRepo = {
  owner: 'octocat',
  name: 'vault',
  branch: 'main',
  isPrivate: true
}

function makeGitHubRepo(over: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 1,
    name: 'vault',
    full_name: 'octocat/vault',
    owner: { login: 'octocat' },
    private: true,
    default_branch: 'main',
    updated_at: '2024-01-01T00:00:00Z',
    ...over
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  // The upload cache is module-level and persists across commitChanges calls
  // (so a token-refresh retry skips already-uploaded blobs). Reset it between
  // tests so cache state from one test can't leak into the next.
  _resetUploadedShaCache()
})

describe('GitHubProvider — identity', () => {
  test('kind is github and baseUrl defaults to the GitHub API base', () => {
    const p = new GitHubProvider(TOKEN)
    expect(p.kind).toBe('github')
    expect(p.baseUrl).toBe('https://api.github.com')
  })

  test('baseUrl can be overridden via the constructor', () => {
    const p = new GitHubProvider(TOKEN, 'https://github.example.com/api/v3')
    expect(p.baseUrl).toBe('https://github.example.com/api/v3')
  })
})

describe('GitHubProvider — git-data read delegation', () => {
  test('getBranchHeadSha → getBranchRefSha(token, owner, repo, branch)', async () => {
    mock.getBranchRefSha.mockResolvedValue('head-sha')
    const p = new GitHubProvider(TOKEN)
    await expect(p.getBranchHeadSha(REPO)).resolves.toBe('head-sha')
    expect(mock.getBranchRefSha).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'main'
    )
  })

  test('getCommitTreeSha → getCommitTreeSha(token, owner, repo, commitSha)', async () => {
    mock.getCommitTreeSha.mockResolvedValue('tree-sha')
    const p = new GitHubProvider(TOKEN)
    await expect(p.getCommitTreeSha(REPO, 'commit-sha')).resolves.toBe(
      'tree-sha'
    )
    expect(mock.getCommitTreeSha).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'commit-sha'
    )
  })

  test('getTreeMap → getTreeMap(token, owner, repo, treeSha)', async () => {
    const treeMap = new Map([['a.md', 'sha-a']])
    mock.getTreeMap.mockResolvedValue(treeMap)
    const p = new GitHubProvider(TOKEN)
    await expect(p.getTreeMap(REPO, 'tree-sha')).resolves.toBe(treeMap)
    expect(mock.getTreeMap).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'tree-sha'
    )
  })

  test('getBlobContent → getBlobContent(token, owner, repo, sha)', async () => {
    mock.getBlobContent.mockResolvedValue('# hi')
    const p = new GitHubProvider(TOKEN)
    await expect(p.getBlobContent(REPO, 'blob-sha')).resolves.toBe('# hi')
    expect(mock.getBlobContent).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'blob-sha'
    )
  })

  // The cached variants (PULL path) must hit the ETag-conditional wrappers,
  // NOT the plain reads — that's the split that keeps PUSH byte-identical.
  test('getTreeMapCached → getTreeMapConditional(token, repo, treeSha)', async () => {
    const treeMap = new Map([['a.md', 'sha-a']])
    etagMock.getTreeMapConditional.mockResolvedValue(treeMap)
    const p = new GitHubProvider(TOKEN)
    await expect(p.getTreeMapCached(REPO, 'tree-sha')).resolves.toBe(treeMap)
    expect(etagMock.getTreeMapConditional).toHaveBeenCalledWith(
      TOKEN,
      REPO,
      'tree-sha'
    )
    expect(mock.getTreeMap).not.toHaveBeenCalled()
  })

  test('getBlobContentCached → getBlobContentConditional(token, repo, sha)', async () => {
    etagMock.getBlobContentConditional.mockResolvedValue('# hi')
    const p = new GitHubProvider(TOKEN)
    await expect(p.getBlobContentCached(REPO, 'blob-sha')).resolves.toBe('# hi')
    expect(etagMock.getBlobContentConditional).toHaveBeenCalledWith(
      TOKEN,
      REPO,
      'blob-sha'
    )
    expect(mock.getBlobContent).not.toHaveBeenCalled()
  })

  test('getBlobBytes → getBlobBytes(token, owner, repo, sha)', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    mock.getBlobBytes.mockResolvedValue(bytes)
    const p = new GitHubProvider(TOKEN)
    await expect(p.getBlobBytes(REPO, 'blob-sha')).resolves.toBe(bytes)
    expect(mock.getBlobBytes).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'blob-sha'
    )
  })
})

describe('GitHubProvider — repo op delegation + shape mapping', () => {
  test('listRepos maps GitHubRepo[] → HostRepo[]', async () => {
    mock.listUserRepos.mockResolvedValue([
      makeGitHubRepo({
        name: 'one',
        owner: { login: 'octocat' },
        private: false,
        default_branch: 'trunk'
      }),
      makeGitHubRepo({
        name: 'two',
        owner: { login: 'someorg' },
        private: true,
        default_branch: 'main'
      })
    ])
    const p = new GitHubProvider(TOKEN)
    const out = await p.listRepos()
    expect(mock.listUserRepos).toHaveBeenCalledWith(TOKEN)
    expect(out).toEqual([
      {
        owner: 'octocat',
        name: 'one',
        defaultBranch: 'trunk',
        isPrivate: false
      },
      { owner: 'someorg', name: 'two', defaultBranch: 'main', isPrivate: true }
    ])
  })

  test('getRepo maps GitHubRepo → HostRepo', async () => {
    mock.getRepo.mockResolvedValue(
      makeGitHubRepo({ name: 'vault', default_branch: 'main', private: true })
    )
    const p = new GitHubProvider(TOKEN)
    await expect(p.getRepo('octocat', 'vault')).resolves.toEqual({
      owner: 'octocat',
      name: 'vault',
      defaultBranch: 'main',
      isPrivate: true
    })
    expect(mock.getRepo).toHaveBeenCalledWith(TOKEN, 'octocat', 'vault')
  })

  test('listBranches maps {name}[] → string[]', async () => {
    mock.listRepoBranches.mockResolvedValue([{ name: 'main' }, { name: 'dev' }])
    const p = new GitHubProvider(TOKEN)
    await expect(p.listBranches('octocat', 'vault')).resolves.toEqual([
      'main',
      'dev'
    ])
    expect(mock.listRepoBranches).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault'
    )
  })

  test('createRepo maps GitHubRepo → HostRepo', async () => {
    mock.createRepo.mockResolvedValue(
      makeGitHubRepo({ name: 'fresh', default_branch: 'main', private: true })
    )
    const p = new GitHubProvider(TOKEN)
    await expect(p.createRepo('fresh', true)).resolves.toEqual({
      owner: 'octocat',
      name: 'fresh',
      defaultBranch: 'main',
      isPrivate: true
    })
    expect(mock.createRepo).toHaveBeenCalledWith(TOKEN, 'fresh', true)
  })
})

describe('GitHubProvider — commitChanges blob→tree→commit→ref', () => {
  test('performs the full sequence for a mixed create/update/delete batch', async () => {
    mock.getCommitTreeSha.mockResolvedValue('base-tree')
    mock.createBlob
      .mockResolvedValueOnce('blob-create')
      .mockResolvedValueOnce('blob-update')
    mock.createTree.mockResolvedValue('new-tree')
    mock.createCommit.mockResolvedValue({
      sha: 'new-commit',
      html_url: 'https://github.com/octocat/vault/commit/new-commit'
    })
    mock.updateBranchRef.mockResolvedValue(undefined)

    const p = new GitHubProvider(TOKEN)
    const result = await p.commitChanges(REPO, {
      branch: 'main',
      parentSha: 'parent-commit',
      message: 'Sync from Noteser (3 changes)',
      changes: [
        { op: 'create', path: 'new.md', content: '# new' },
        { op: 'update', path: 'old.md', content: '# old v2' },
        { op: 'delete', path: 'gone.md', sha: 'gone-sha' }
      ]
    })

    // Base tree resolved from the parent commit.
    expect(mock.getCommitTreeSha).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'parent-commit'
    )

    // One blob per create/update; delete uploads nothing.
    expect(mock.createBlob).toHaveBeenCalledTimes(2)
    expect(mock.createBlob).toHaveBeenNthCalledWith(
      1,
      TOKEN,
      'octocat',
      'vault',
      '# new'
    )
    expect(mock.createBlob).toHaveBeenNthCalledWith(
      2,
      TOKEN,
      'octocat',
      'vault',
      '# old v2'
    )
    expect(mock.createBlobBinary).not.toHaveBeenCalled()

    // Tree built against the base tree; delete is a sha:null entry.
    expect(mock.createTree).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'base-tree',
      [
        { path: 'new.md', mode: '100644', type: 'blob', sha: 'blob-create' },
        { path: 'old.md', mode: '100644', type: 'blob', sha: 'blob-update' },
        { path: 'gone.md', mode: '100644', type: 'blob', sha: null }
      ]
    )

    // Commit parented on parentSha, then fast-forward the branch.
    expect(mock.createCommit).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'Sync from Noteser (3 changes)',
      'new-tree',
      'parent-commit'
    )
    expect(mock.updateBranchRef).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'main',
      'new-commit'
    )

    expect(result).toEqual({
      commitSha: 'new-commit',
      commitUrl: 'https://github.com/octocat/vault/commit/new-commit',
      committed: true,
      // Both create/update blobs were freshly uploaded; the delete carries no blob.
      uploadedPaths: ['new.md', 'old.md']
    })
  })

  test('no-op-tree skip: when the built tree equals the parent tree, no commit is created', async () => {
    // createTree resolves to the SAME sha the parent commit's tree resolves
    // to — the change set was a no-op (e.g. content round-tripped to identical
    // bytes). The push must skip commit + ref and report committed:false.
    mock.getCommitTreeSha.mockResolvedValue('same-tree')
    mock.createBlob.mockResolvedValue('blob-x')
    mock.createTree.mockResolvedValue('same-tree')

    const p = new GitHubProvider(TOKEN)
    const result = await p.commitChanges(REPO, {
      branch: 'main',
      parentSha: 'parent-commit',
      message: 'noop',
      changes: [{ op: 'update', path: 'a.md', content: '# a' }]
    })

    expect(mock.createTree).toHaveBeenCalledTimes(1)
    expect(mock.createCommit).not.toHaveBeenCalled()
    expect(mock.updateBranchRef).not.toHaveBeenCalled()
    expect(result).toEqual({
      commitSha: 'parent-commit',
      commitUrl: null,
      committed: false,
      uploadedPaths: ['a.md']
    })
  })

  test('upload cache: a second commit of the same content skips the blob POST', async () => {
    mock.getCommitTreeSha.mockResolvedValue('base-tree')
    mock.createBlob.mockResolvedValue('blob-1')
    mock.createTree.mockResolvedValueOnce('tree-1')
    mock.createCommit.mockResolvedValue({ sha: 'c1', html_url: 'u1' })
    mock.updateBranchRef.mockResolvedValue(undefined)

    const p = new GitHubProvider(TOKEN)
    // First commit fails AFTER the blob upload but before clearing the cache,
    // by throwing on createCommit — so the uploaded blob sha stays cached.
    mock.createCommit.mockRejectedValueOnce(new Error('boom'))
    await expect(
      p.commitChanges(REPO, {
        branch: 'main',
        parentSha: 'parent',
        message: 'first',
        changes: [{ op: 'create', path: 'n.md', content: '# n' }]
      })
    ).rejects.toThrow('boom')
    expect(mock.createBlob).toHaveBeenCalledTimes(1)

    // Retry with the same content: the blob is cached → no second POST, and it
    // is reported as skipped (not uploaded) so the caller suppresses the
    // redundant path-metadata update.
    mock.createCommit.mockResolvedValue({ sha: 'c2', html_url: 'u2' })
    const result = await p.commitChanges(REPO, {
      branch: 'main',
      parentSha: 'parent',
      message: 'retry',
      changes: [{ op: 'create', path: 'n.md', content: '# n' }]
    })
    expect(mock.createBlob).toHaveBeenCalledTimes(1) // still only the first POST
    expect(result.committed).toBe(true)
    expect(result.uploadedPaths).toEqual([]) // served from cache, not transmitted
  })

  test('binary file changes go through createBlobBinary, not createBlob', async () => {
    mock.getCommitTreeSha.mockResolvedValue('base-tree')
    mock.createBlobBinary.mockResolvedValue('binary-blob')
    mock.createTree.mockResolvedValue('new-tree')
    mock.createCommit.mockResolvedValue({ sha: 'c', html_url: 'u' })
    mock.updateBranchRef.mockResolvedValue(undefined)

    const bytes = new Uint8Array([0xff, 0x00, 0x10])
    const p = new GitHubProvider(TOKEN)
    await p.commitChanges(REPO, {
      branch: 'main',
      parentSha: 'parent',
      message: 'add image',
      changes: [{ op: 'create', path: 'img.png', contentBytes: bytes }]
    })

    expect(mock.createBlob).not.toHaveBeenCalled()
    expect(mock.createBlobBinary).toHaveBeenCalledTimes(1)
    const [tok, owner, repo, blobArg] = mock.createBlobBinary.mock.calls[0]
    expect(tok).toBe(TOKEN)
    expect(owner).toBe('octocat')
    expect(repo).toBe('vault')
    expect(blobArg).toBeInstanceOf(Blob)
    expect(mock.createTree).toHaveBeenCalledWith(
      TOKEN,
      'octocat',
      'vault',
      'base-tree',
      [{ path: 'img.png', mode: '100644', type: 'blob', sha: 'binary-blob' }]
    )
  })
})

describe('getAuthenticatedUser', () => {
  it('delegates to fetchGitHubUser and maps to HostUser', async () => {
    ;(fetchGitHubUser as jest.Mock).mockResolvedValueOnce({
      id: 7,
      login: 'mona',
      name: 'Mona',
      avatar_url: 'https://gh/a.png'
    })
    const provider = new GitHubProvider('tok')
    const user = await provider.getAuthenticatedUser()
    expect(fetchGitHubUser).toHaveBeenCalledWith('tok')
    expect(user).toEqual({
      id: 7,
      login: 'mona',
      name: 'Mona',
      avatarUrl: 'https://gh/a.png'
    })
  })
})
