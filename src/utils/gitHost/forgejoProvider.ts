// ForgejoProvider: the Forgejo/Gitea implementation of the GitHostProvider
// seam. Codeberg is just a base-URL preset (https://codeberg.org); any
// self-hosted Forgejo/Gitea instance works via a configurable baseUrl.
//
// Unlike GitHubProvider (a thin wrap of github.ts), this provider talks to
// the Gitea API directly at `{baseUrl}/api/v1`. The big divergence from
// GitHub is the write path: Forgejo's git-data endpoints are read-only, so
// commitChanges goes through `POST /repos/{owner}/{repo}/contents` (the
// ChangeFiles batch API) — one request writes N files as a single commit.
// See docs/multi-host-sync-plan.md.

import type { SyncRepo } from '@/types'
import { base64ToBytes } from '../github'
import type {
  GitHostProvider,
  HostKind,
  HostRepo,
  HostUser,
  CommitRequest,
  CommitResult
} from './types'

const CODEBERG_BASE = 'https://codeberg.org'

// Gitea caps repo listings; 50 keeps each page small enough to stay snappy.
const REPOS_PER_PAGE = 50

// Typed error thrown at the network boundary for any non-ok Gitea response.
// Carries the HTTP status and the API's error message (when the body parses
// as JSON) so the UI can show a precise message instead of a bare code.
export class ForgejoAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly operation: string,
    public readonly serverMessage: string | null
  ) {
    const tail = serverMessage ? ` — ${serverMessage}` : ''
    super(`${operation} failed (${status})${tail}`)
    this.name = 'ForgejoAPIError'
  }

  static async fromResponse(
    res: Response,
    operation: string
  ): Promise<ForgejoAPIError> {
    let serverMessage: string | null = null
    try {
      const body = (await res.clone().json()) as { message?: string }
      if (typeof body.message === 'string') serverMessage = body.message
    } catch {
      // Body wasn't JSON, leave message null.
    }
    return new ForgejoAPIError(res.status, operation, serverMessage)
  }
}

// Base64-encode a UTF-8 string for the ChangeFiles `content` field. TextEncoder
// + btoa (btoa alone only handles Latin-1).
function utf8ToBase64(content: string): string {
  const bytes = new TextEncoder().encode(content)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

interface GiteaRepo {
  name: string
  owner: { login: string }
  default_branch: string
  private: boolean
}

function toHostRepo(repo: GiteaRepo): HostRepo {
  return {
    owner: repo.owner.login,
    name: repo.name,
    defaultBranch: repo.default_branch,
    isPrivate: repo.private
  }
}

export class ForgejoProvider implements GitHostProvider {
  readonly kind: HostKind = 'forgejo'
  readonly baseUrl: string

  constructor(
    private readonly token: string,
    baseUrl: string = CODEBERG_BASE
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private get apiBase(): string {
    return `${this.baseUrl}/api/v1`
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/json',
      ...extra
    }
  }

  private async get(path: string, operation: string): Promise<unknown> {
    const res = await fetch(`${this.apiBase}${path}`, {
      headers: this.headers()
    })
    if (!res.ok) throw await ForgejoAPIError.fromResponse(res, operation)
    return res.json()
  }

  // --- repo ops ---
  async listRepos(): Promise<HostRepo[]> {
    const out: HostRepo[] = []
    for (let page = 1; ; page++) {
      const batch = (await this.get(
        `/user/repos?limit=${REPOS_PER_PAGE}&page=${page}`,
        'List repos'
      )) as GiteaRepo[]
      out.push(...batch.map(toHostRepo))
      if (batch.length < REPOS_PER_PAGE) break
    }
    return out
  }

  async getRepo(owner: string, name: string): Promise<HostRepo> {
    const repo = (await this.get(
      `/repos/${owner}/${name}`,
      'Fetch repo'
    )) as GiteaRepo
    return toHostRepo(repo)
  }

  async listBranches(owner: string, name: string): Promise<string[]> {
    const branches = (await this.get(
      `/repos/${owner}/${name}/branches`,
      'List branches'
    )) as { name: string }[]
    return branches.map(b => b.name)
  }

  async createRepo(name: string, isPrivate: boolean): Promise<HostRepo> {
    const res = await fetch(`${this.apiBase}/user/repos`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, private: isPrivate, auto_init: true })
    })
    if (!res.ok) throw await ForgejoAPIError.fromResponse(res, 'Create repo')
    return toHostRepo((await res.json()) as GiteaRepo)
  }

  async getAuthenticatedUser(): Promise<HostUser> {
    const data = (await this.get('/user', 'Read user')) as {
      id: number
      login: string
      full_name?: string
      avatar_url?: string
    }
    return {
      id: data.id,
      login: data.login,
      name: data.full_name ? data.full_name : null,
      avatarUrl: data.avatar_url
    }
  }

  // --- git-data READ ---
  async getBranchHeadSha(repo: SyncRepo): Promise<string> {
    // The refs endpoint returns an array when the path is a prefix match for
    // multiple refs, or a single object for an exact match.
    const data = (await this.get(
      `/repos/${repo.owner}/${repo.name}/git/refs/heads/${repo.branch}`,
      'Read ref'
    )) as { object: { sha: string } } | { object: { sha: string } }[]
    return Array.isArray(data) ? data[0].object.sha : data.object.sha
  }

  async getCommitTreeSha(repo: SyncRepo, commitSha: string): Promise<string> {
    // Forgejo nests the tree sha under `.commit.tree.sha` (GitHub puts it at
    // the top-level `.tree.sha`).
    const data = (await this.get(
      `/repos/${repo.owner}/${repo.name}/git/commits/${commitSha}`,
      'Read commit'
    )) as { commit: { tree: { sha: string } } }
    return data.commit.tree.sha
  }

  async getTreeMap(
    repo: SyncRepo,
    treeSha: string
  ): Promise<Map<string, string>> {
    // Forgejo paginates large recursive trees via ?page=; follow `truncated`
    // until the whole tree is read.
    const out = new Map<string, string>()
    for (let page = 1; ; page++) {
      const data = (await this.get(
        `/repos/${repo.owner}/${repo.name}/git/trees/${treeSha}?recursive=true&page=${page}`,
        'Read tree'
      )) as {
        tree: Array<{ path: string; type: string; sha: string }>
        truncated?: boolean
      }
      for (const entry of data.tree) {
        if (entry.type === 'blob') out.set(entry.path, entry.sha)
      }
      if (!data.truncated) break
    }
    return out
  }

  async getBlobContent(repo: SyncRepo, sha: string): Promise<string> {
    const data = (await this.get(
      `/repos/${repo.owner}/${repo.name}/git/blobs/${sha}`,
      `Read blob ${sha}`
    )) as { content: string; encoding: string }
    return new TextDecoder('utf-8').decode(base64ToBytes(data.content))
  }

  // Forgejo/Gitea has no ETag-conditional read layer here, so the cached
  // variants are plain reads — same result, no caching. (The seam's PULL path
  // calls these; PUSH uses getTreeMap/getBlobContent.)
  getTreeMapCached(
    repo: SyncRepo,
    treeSha: string
  ): Promise<Map<string, string>> {
    return this.getTreeMap(repo, treeSha)
  }

  getBlobContentCached(repo: SyncRepo, sha: string): Promise<string> {
    return this.getBlobContent(repo, sha)
  }

  async getBlobBytes(repo: SyncRepo, sha: string): Promise<Uint8Array> {
    const data = (await this.get(
      `/repos/${repo.owner}/${repo.name}/git/blobs/${sha}`,
      `Read binary blob ${sha}`
    )) as { content: string; encoding: string }
    return base64ToBytes(data.content)
  }

  // --- bulk archive (first-clone fast path) ---
  async fetchArchive(repo: SyncRepo, ref: string): Promise<ArrayBuffer> {
    const res = await fetch(
      `${this.apiBase}/repos/${repo.owner}/${repo.name}/archive/${ref}.zip`,
      { headers: this.headers() }
    )
    if (!res.ok)
      throw await ForgejoAPIError.fromResponse(res, 'Download archive')
    return res.arrayBuffer()
  }

  // --- git-data WRITE ---
  // One `POST /contents` with a ChangeFiles batch: every create/update/delete
  // is a single ChangeFileOperation and the server builds the blobs, tree, and
  // commit and advances the branch in one shot. Create/update carry base64
  // content; update/delete carry the current blob sha. An empty change set is
  // a no-op (syncPush already filters unchanged files), so it makes no network
  // call and reports committed:false — preserving the no-churn invariant.
  async commitChanges(
    repo: SyncRepo,
    req: CommitRequest
  ): Promise<CommitResult> {
    if (req.changes.length === 0) {
      return {
        commitSha: req.parentSha,
        commitUrl: null,
        committed: false,
        uploadedPaths: []
      }
    }

    const files = req.changes.map(change => {
      if (change.op === 'delete') {
        return { operation: 'delete', path: change.path, sha: change.sha }
      }
      const content = change.contentBytes
        ? bytesToBase64(change.contentBytes)
        : utf8ToBase64(change.content ?? '')
      return change.op === 'update'
        ? { operation: 'update', path: change.path, content, sha: change.sha }
        : { operation: 'create', path: change.path, content }
    })

    const uploadedPaths = req.changes
      .filter(c => c.op !== 'delete')
      .map(c => c.path)

    // Forgejo writes are a single request — no per-blob progress.
    req.onProgress?.({ phase: 'committing' })

    const res = await fetch(
      `${this.apiBase}/repos/${repo.owner}/${repo.name}/contents`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          branch: req.branch,
          message: req.message,
          files
        })
      }
    )
    if (!res.ok) throw await ForgejoAPIError.fromResponse(res, 'Commit changes')
    const data = (await res.json()) as {
      commit: { sha: string; html_url?: string }
    }

    return {
      commitSha: data.commit.sha,
      commitUrl: data.commit.html_url ?? null,
      committed: true,
      uploadedPaths
    }
  }
}
