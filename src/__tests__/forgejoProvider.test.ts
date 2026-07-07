/**
 * @jest-environment node
 *
 * ForgejoProvider is the Forgejo/Gitea implementation of the GitHostProvider
 * seam (docs/multi-host-sync-plan.md). Unlike GitHubProvider (a thin wrap of
 * utils/github.ts), Forgejo talks to its own `{baseUrl}/api/v1` endpoints
 * directly, so these tests mock global `fetch` and assert:
 *
 *   - the Gitea-style auth header (`Authorization: token <PAT>`) and the
 *     baseUrl default (codeberg) + override are applied to every request,
 *   - each read method hits the right URL and parses the right field — note
 *     getCommitTreeSha reads `.commit.tree.sha`, NOT a top-level `.tree.sha`,
 *   - getTreeMap keeps only `type === 'blob'` entries,
 *   - commitChanges maps a mixed create/update/delete batch onto the
 *     `ChangeFiles` payload (base64 content, sha on update/delete) in one POST,
 *     and short-circuits an empty change set with no network call,
 *   - fetchArchive targets the `/archive/{ref}.zip` endpoint.
 */

import type { SyncRepo } from '@/types'
import { ForgejoProvider } from '../utils/gitHost/forgejoProvider'

const TOKEN = 'pat-abc'
const REPO: SyncRepo = {
  owner: 'octo',
  name: 'vault',
  branch: 'main',
  isPrivate: true
}
const CODEBERG = 'https://codeberg.org'

// Minimal mock Response. `ok` is derived from status; json()/arrayBuffer()
// hand back whatever the test queued.
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
    clone() {
      return this
    },
    headers: new Map() as unknown as Headers
  } as unknown as Response
}

function arrayBufferResponse(buf: ArrayBuffer, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    arrayBuffer: async () => buf,
    clone() {
      return this
    },
    headers: new Map() as unknown as Headers
  } as unknown as Response
}

let fetchMock: jest.Mock

beforeEach(() => {
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.resetAllMocks()
})

// Pull the (url, init) of the Nth fetch call (0-indexed).
function call(n = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[n]
  return { url: url as string, init: (init ?? {}) as RequestInit }
}

function authHeader(init: RequestInit): string | undefined {
  const headers = (init.headers ?? {}) as Record<string, string>
  return headers['Authorization']
}

describe('ForgejoProvider — identity + auth', () => {
  test('kind is forgejo and baseUrl defaults to codeberg', () => {
    const p = new ForgejoProvider(TOKEN)
    expect(p.kind).toBe('forgejo')
    expect(p.baseUrl).toBe(CODEBERG)
  })

  test('baseUrl can be overridden for self-hosted instances', () => {
    const p = new ForgejoProvider(TOKEN, 'https://git.example.com')
    expect(p.baseUrl).toBe('https://git.example.com')
  })

  test('a trailing slash on the baseUrl is normalised away', () => {
    const p = new ForgejoProvider(TOKEN, 'https://git.example.com/')
    expect(p.baseUrl).toBe('https://git.example.com')
  })

  test('requests send the Gitea-style "token <PAT>" auth header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ object: { sha: 'x' } }))
    const p = new ForgejoProvider(TOKEN)
    await p.getBranchHeadSha(REPO)
    expect(authHeader(call().init)).toBe(`token ${TOKEN}`)
  })
})

describe('ForgejoProvider — git-data read', () => {
  test('getBranchHeadSha hits git/refs/heads and reads object.sha (object form)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ object: { sha: 'head-sha' } }))
    const p = new ForgejoProvider(TOKEN)
    await expect(p.getBranchHeadSha(REPO)).resolves.toBe('head-sha')
    expect(call().url).toBe(
      `${CODEBERG}/api/v1/repos/octo/vault/git/refs/heads/main`
    )
  })

  test('getBranchHeadSha handles the array response form', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ object: { sha: 'arr-sha' } }]))
    const p = new ForgejoProvider(TOKEN)
    await expect(p.getBranchHeadSha(REPO)).resolves.toBe('arr-sha')
  })

  test('getCommitTreeSha reads .commit.tree.sha (not top-level)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ sha: 'commit-sha', commit: { tree: { sha: 'tree-sha' } } })
    )
    const p = new ForgejoProvider(TOKEN)
    await expect(p.getCommitTreeSha(REPO, 'commit-sha')).resolves.toBe(
      'tree-sha'
    )
    expect(call().url).toBe(
      `${CODEBERG}/api/v1/repos/octo/vault/git/commits/commit-sha`
    )
  })

  test('getTreeMap requests recursively and keeps only blob entries', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        tree: [
          { path: 'a.md', type: 'blob', sha: 'sha-a' },
          { path: 'sub', type: 'tree', sha: 'sha-sub' },
          { path: 'sub/b.md', type: 'blob', sha: 'sha-b' }
        ],
        truncated: false,
        total_count: 3
      })
    )
    const p = new ForgejoProvider(TOKEN)
    const map = await p.getTreeMap(REPO, 'tree-sha')
    expect(call().url).toBe(
      `${CODEBERG}/api/v1/repos/octo/vault/git/trees/tree-sha?recursive=true&page=1`
    )
    expect(map).toEqual(
      new Map([
        ['a.md', 'sha-a'],
        ['sub/b.md', 'sha-b']
      ])
    )
  })

  // Forgejo has no ETag layer, so the cached variants are plain aliases —
  // same endpoint, same result as getTreeMap / getBlobContent.
  test('getTreeMapCached aliases the plain getTreeMap (no ETag layer)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        tree: [{ path: 'a.md', type: 'blob', sha: 'sha-a' }],
        truncated: false,
        total_count: 1
      })
    )
    const p = new ForgejoProvider(TOKEN)
    const map = await p.getTreeMapCached(REPO, 'tree-sha')
    expect(call().url).toBe(
      `${CODEBERG}/api/v1/repos/octo/vault/git/trees/tree-sha?recursive=true&page=1`
    )
    expect(map).toEqual(new Map([['a.md', 'sha-a']]))
  })

  test('getBlobContentCached aliases the plain getBlobContent (no ETag layer)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ content: btoa('# hi'), encoding: 'base64' })
    )
    const p = new ForgejoProvider(TOKEN)
    await expect(p.getBlobContentCached(REPO, 'blob-sha')).resolves.toBe('# hi')
    expect(call().url).toBe(
      `${CODEBERG}/api/v1/repos/octo/vault/git/blobs/blob-sha`
    )
  })

  test('getTreeMap pages through a truncated tree', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          tree: [{ path: 'a.md', type: 'blob', sha: 'sha-a' }],
          truncated: true,
          total_count: 2
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          tree: [{ path: 'b.md', type: 'blob', sha: 'sha-b' }],
          truncated: false,
          total_count: 2
        })
      )
    const p = new ForgejoProvider(TOKEN)
    const map = await p.getTreeMap(REPO, 'tree-sha')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(call(1).url).toBe(
      `${CODEBERG}/api/v1/repos/octo/vault/git/trees/tree-sha?recursive=true&page=2`
    )
    expect(map).toEqual(
      new Map([
        ['a.md', 'sha-a'],
        ['b.md', 'sha-b']
      ])
    )
  })

  test('getBlobContent decodes base64 to a UTF-8 string', async () => {
    const text = '# héllo'
    const b64 = Buffer.from(text, 'utf-8').toString('base64')
    fetchMock.mockResolvedValue(
      jsonResponse({ content: b64, encoding: 'base64' })
    )
    const p = new ForgejoProvider(TOKEN)
    await expect(p.getBlobContent(REPO, 'blob-sha')).resolves.toBe(text)
    expect(call().url).toBe(
      `${CODEBERG}/api/v1/repos/octo/vault/git/blobs/blob-sha`
    )
  })

  test('getBlobBytes returns raw bytes from the base64 content', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x10])
    const b64 = Buffer.from(bytes).toString('base64')
    fetchMock.mockResolvedValue(
      jsonResponse({ content: b64, encoding: 'base64' })
    )
    const p = new ForgejoProvider(TOKEN)
    await expect(p.getBlobBytes(REPO, 'blob-sha')).resolves.toEqual(bytes)
  })
})

describe('ForgejoProvider — repo ops', () => {
  function giteaRepo(over: Record<string, unknown> = {}) {
    return {
      name: 'vault',
      owner: { login: 'octo' },
      default_branch: 'main',
      private: true,
      ...over
    }
  }

  test('listRepos paginates and maps to HostRepo[]', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          Array.from({ length: 50 }, (_, i) =>
            giteaRepo({ name: `r${i}`, default_branch: 'main', private: false })
          )
        )
      )
      .mockResolvedValueOnce(jsonResponse([giteaRepo({ name: 'last' })]))
    const p = new ForgejoProvider(TOKEN)
    const repos = await p.listRepos()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(call(0).url).toBe(`${CODEBERG}/api/v1/user/repos?limit=50&page=1`)
    expect(repos).toHaveLength(51)
    expect(repos[0]).toEqual({
      owner: 'octo',
      name: 'r0',
      defaultBranch: 'main',
      isPrivate: false
    })
    expect(repos[50]).toEqual({
      owner: 'octo',
      name: 'last',
      defaultBranch: 'main',
      isPrivate: true
    })
  })

  test('getRepo maps a Gitea repo to HostRepo', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(giteaRepo({ name: 'vault', private: true }))
    )
    const p = new ForgejoProvider(TOKEN)
    await expect(p.getRepo('octo', 'vault')).resolves.toEqual({
      owner: 'octo',
      name: 'vault',
      defaultBranch: 'main',
      isPrivate: true
    })
    expect(call().url).toBe(`${CODEBERG}/api/v1/repos/octo/vault`)
  })

  test('listBranches maps {name}[] to string[]', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ name: 'main' }, { name: 'dev' }])
    )
    const p = new ForgejoProvider(TOKEN)
    await expect(p.listBranches('octo', 'vault')).resolves.toEqual([
      'main',
      'dev'
    ])
    expect(call().url).toBe(`${CODEBERG}/api/v1/repos/octo/vault/branches`)
  })

  test('createRepo posts to /user/repos with auto_init and maps the result', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(giteaRepo({ name: 'fresh', private: false }))
    )
    const p = new ForgejoProvider(TOKEN)
    await expect(p.createRepo('fresh', false)).resolves.toEqual({
      owner: 'octo',
      name: 'fresh',
      defaultBranch: 'main',
      isPrivate: false
    })
    const { url, init } = call()
    expect(url).toBe(`${CODEBERG}/api/v1/user/repos`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'fresh',
      private: false,
      auto_init: true
    })
  })
})

describe('ForgejoProvider — commitChanges (ChangeFiles)', () => {
  test('maps a mixed create/update/delete batch into one POST /contents', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        commit: {
          sha: 'new-commit',
          html_url: 'https://codeberg.org/octo/vault/commit/new-commit'
        }
      })
    )
    const onProgress = jest.fn()
    const p = new ForgejoProvider(TOKEN)
    const result = await p.commitChanges(REPO, {
      branch: 'main',
      parentSha: 'parent',
      message: 'Sync from Noteser (3 changes)',
      changes: [
        { op: 'create', path: 'new.md', content: '# new' },
        { op: 'update', path: 'old.md', content: '# old v2', sha: 'old-sha' },
        { op: 'delete', path: 'gone.md', sha: 'gone-sha' }
      ],
      onProgress
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init } = call()
    expect(url).toBe(`${CODEBERG}/api/v1/repos/octo/vault/contents`)
    expect(init.method).toBe('POST')
    expect(authHeader(init)).toBe(`token ${TOKEN}`)
    expect(JSON.parse(init.body as string)).toEqual({
      branch: 'main',
      message: 'Sync from Noteser (3 changes)',
      files: [
        {
          operation: 'create',
          path: 'new.md',
          content: Buffer.from('# new', 'utf-8').toString('base64')
        },
        {
          operation: 'update',
          path: 'old.md',
          content: Buffer.from('# old v2', 'utf-8').toString('base64'),
          sha: 'old-sha'
        },
        { operation: 'delete', path: 'gone.md', sha: 'gone-sha' }
      ]
    })

    expect(result).toEqual({
      commitSha: 'new-commit',
      commitUrl: 'https://codeberg.org/octo/vault/commit/new-commit',
      committed: true,
      uploadedPaths: ['new.md', 'old.md']
    })
    expect(onProgress).toHaveBeenCalledWith({ phase: 'committing' })
  })

  test('binary changes use contentBytes for the base64 content', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ commit: { sha: 'c', html_url: 'u' } })
    )
    const bytes = new Uint8Array([0xff, 0x00, 0x10])
    const p = new ForgejoProvider(TOKEN)
    await p.commitChanges(REPO, {
      branch: 'main',
      parentSha: 'parent',
      message: 'add image',
      changes: [{ op: 'create', path: 'img.png', contentBytes: bytes }]
    })
    const body = JSON.parse(call().init.body as string)
    expect(body.files[0]).toEqual({
      operation: 'create',
      path: 'img.png',
      content: Buffer.from(bytes).toString('base64')
    })
  })

  test('an empty change set makes NO network call and reports committed:false', async () => {
    const p = new ForgejoProvider(TOKEN)
    const result = await p.commitChanges(REPO, {
      branch: 'main',
      parentSha: 'parent-sha',
      message: 'noop',
      changes: []
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      commitSha: 'parent-sha',
      commitUrl: null,
      committed: false,
      uploadedPaths: []
    })
  })

  test('commitUrl falls back to null when the response omits html_url', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ commit: { sha: 'c' } }))
    const p = new ForgejoProvider(TOKEN)
    const result = await p.commitChanges(REPO, {
      branch: 'main',
      parentSha: 'parent',
      message: 'm',
      changes: [{ op: 'create', path: 'a.md', content: '# a' }]
    })
    expect(result.commitUrl).toBeNull()
  })
})

describe('ForgejoProvider — fetchArchive', () => {
  test('downloads the .zip archive for the ref as an ArrayBuffer', async () => {
    const buf = new Uint8Array([1, 2, 3, 4]).buffer
    fetchMock.mockResolvedValue(arrayBufferResponse(buf))
    const p = new ForgejoProvider(TOKEN)
    await expect(p.fetchArchive(REPO, 'main')).resolves.toBe(buf)
    expect(call().url).toBe(
      `${CODEBERG}/api/v1/repos/octo/vault/archive/main.zip`
    )
  })
})

describe('ForgejoProvider — error handling', () => {
  test('a non-ok response throws an error carrying the status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404))
    const p = new ForgejoProvider(TOKEN)
    await expect(p.getRepo('octo', 'missing')).rejects.toThrow(/404/)
  })
})

describe('getAuthenticatedUser', () => {
  it('maps the Gitea /user payload to HostUser', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 42,
        login: 'octo',
        full_name: 'Octo Cat',
        avatar_url: 'https://c.org/a.png'
      })
    )
    const provider = new ForgejoProvider(TOKEN, CODEBERG)
    const user = await provider.getAuthenticatedUser()
    expect(fetchMock).toHaveBeenCalledWith(
      `${CODEBERG}/api/v1/user`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `token ${TOKEN}` })
      })
    )
    expect(user).toEqual({
      id: 42,
      login: 'octo',
      name: 'Octo Cat',
      avatarUrl: 'https://c.org/a.png'
    })
  })

  it('throws ForgejoAPIError on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'bad token' }, 401))
    const provider = new ForgejoProvider(TOKEN, CODEBERG)
    await expect(provider.getAuthenticatedUser()).rejects.toThrow(/401/)
  })
})
