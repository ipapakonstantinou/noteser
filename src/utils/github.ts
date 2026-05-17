import type { GitHubUser, GitHubRepo } from '@/types'

export interface DeviceFlowStart {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export class DeviceFlowError extends Error {
  constructor(public code: 'expired' | 'denied' | 'config' | 'network' | 'aborted' | 'unknown', message: string) {
    super(message)
    this.name = 'DeviceFlowError'
  }
}

// ── Step 1: ask the proxy to request a device code from GitHub ──────────────
export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch('/api/github/device-code', { method: 'POST' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) {
    if (json.error === 'missing_client_id') {
      throw new DeviceFlowError('config', json.error_description ?? 'GitHub Client ID not configured')
    }
    throw new DeviceFlowError('network', json.error_description ?? `Device-code request failed (${res.status})`)
  }
  return json
}

interface PollOptions {
  deviceCode: string
  interval: number       // seconds (from GitHub)
  expiresIn: number      // seconds (from GitHub)
  signal: AbortSignal    // so the caller can cancel the loop
}

// ── Step 2: poll the proxy until the user authorizes or the code expires ────
export async function pollForToken({ deviceCode, interval, expiresIn, signal }: PollOptions): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000
  let currentInterval = interval

  while (Date.now() < deadline) {
    if (signal.aborted) throw new DeviceFlowError('aborted', 'Polling aborted')
    await sleep(currentInterval * 1000, signal)

    const res = await fetch('/api/github/access-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    })
    const json = await res.json().catch(() => ({}))

    if (json.access_token) return json.access_token as string

    switch (json.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        currentInterval += 5
        continue
      case 'expired_token':
        throw new DeviceFlowError('expired', 'The device code expired. Please try again.')
      case 'access_denied':
        throw new DeviceFlowError('denied', 'Authorization was denied.')
      case 'missing_client_id':
        throw new DeviceFlowError('config', 'GitHub Client ID not configured.')
      default:
        throw new DeviceFlowError('unknown', json.error_description ?? json.error ?? 'Unexpected error')
    }
  }
  throw new DeviceFlowError('expired', 'Device code expired before authorization completed.')
}

// ── Step 3: use the token to fetch identifying info ─────────────────────────
export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`)
  const data = await res.json()
  return {
    id: data.id,
    login: data.login,
    name: data.name ?? null,
    avatar_url: data.avatar_url,
  }
}

// ── Repo APIs (after auth) ──────────────────────────────────────────────────
// All of these talk to api.github.com directly — that endpoint supports CORS
// with a bearer token, so no proxy is needed.

const GH_HEADERS = (token: string) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

// Fetch up to ~500 of the user's repos (owner + collaborator + org member).
export async function listUserRepos(token: string): Promise<GitHubRepo[]> {
  const out: GitHubRepo[] = []
  const PER_PAGE = 100
  const MAX_PAGES = 5
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/user/repos?per_page=${PER_PAGE}&sort=updated&affiliation=owner,collaborator,organization_member&page=${page}`
    const res = await fetch(url, { headers: GH_HEADERS(token) })
    if (!res.ok) throw new Error(`Failed to list repos (${res.status})`)
    const batch: GitHubRepo[] = await res.json()
    out.push(...batch)
    if (batch.length < PER_PAGE) break
  }
  return out
}

export async function listRepoBranches(token: string, owner: string, repo: string): Promise<{ name: string }[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    { headers: GH_HEADERS(token) },
  )
  if (!res.ok) throw new Error(`Failed to list branches (${res.status})`)
  return res.json()
}

export async function getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: GH_HEADERS(token) },
  )
  if (!res.ok) throw new Error(`Failed to fetch repo (${res.status})`)
  return res.json()
}

// Creates a new repo under the authenticated user. `auto_init: true` gives
// the repo an initial commit so the default branch exists immediately.
export async function createRepo(
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<GitHubRepo> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      private: isPrivate,
      auto_init: true,
      description: 'Noteser vault',
    }),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const detail = errBody.errors?.[0]?.message ?? errBody.message ?? `HTTP ${res.status}`
    throw new Error(`Failed to create repo: ${detail}`)
  }
  return res.json()
}

// ── Git Data API (for bundling many file changes into one commit) ──────────
// Reference: https://docs.github.com/en/rest/git
//
// One sync = N+5 API calls:
//   1× GET refs/heads/{branch}     → current commit SHA
//   1× GET commits/{sha}           → tree SHA
//   1× GET trees/{sha}?recursive=1 → map of path → blob SHA
//   K× POST git/blobs              → only files whose content actually changed
//   1× POST git/trees              → new tree
//   1× POST git/commits            → new commit
//   1× PATCH refs/heads/{branch}   → fast-forward the branch

export interface GitTreeEntry { path: string; mode: '100644'; type: 'blob'; sha: string | null }

export async function getBranchRefSha(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { headers: GH_HEADERS(token) },
  )
  if (!res.ok) throw new Error(`Failed to read ref (${res.status})`)
  const data = await res.json()
  return data.object.sha
}

export async function getCommitTreeSha(token: string, owner: string, repo: string, commitSha: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`,
    { headers: GH_HEADERS(token) },
  )
  if (!res.ok) throw new Error(`Failed to read commit (${res.status})`)
  const data = await res.json()
  return data.tree.sha
}

// Map of repo path → existing blob SHA (only blob entries, not subtrees).
export async function getTreeMap(token: string, owner: string, repo: string, treeSha: string): Promise<Map<string, string>> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    { headers: GH_HEADERS(token) },
  )
  if (!res.ok) throw new Error(`Failed to read tree (${res.status})`)
  const data = await res.json()
  const out = new Map<string, string>()
  for (const entry of data.tree as Array<{ path: string; type: string; sha: string }>) {
    if (entry.type === 'blob') out.set(entry.path, entry.sha)
  }
  return out
}

export async function createBlob(token: string, owner: string, repo: string, content: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
    {
      method: 'POST',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    },
  )
  if (!res.ok) throw new Error(`Failed to create blob (${res.status})`)
  const data = await res.json()
  return data.sha as string
}

export async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTreeSha: string,
  entries: GitTreeEntry[],
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: 'POST',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
    },
  )
  if (!res.ok) throw new Error(`Failed to create tree (${res.status})`)
  const data = await res.json()
  return data.sha as string
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parentSha: string,
): Promise<{ sha: string; html_url: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
    },
  )
  if (!res.ok) throw new Error(`Failed to create commit (${res.status})`)
  const data = await res.json()
  return { sha: data.sha, html_url: data.html_url }
}

export async function updateBranchRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  commitSha: string,
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: 'PATCH',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: commitSha, force: false }),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Failed to update branch (${res.status}): ${err.message ?? ''}`)
  }
}

// Fetch a blob's content by SHA. GitHub returns it base64-encoded.
export async function getBlobContent(token: string, owner: string, repo: string, sha: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers: GH_HEADERS(token) },
  )
  if (!res.ok) throw new Error(`Failed to read blob ${sha} (${res.status})`)
  const data = await res.json()
  // GitHub may also return content with encoding 'utf-8' for small text blobs,
  // but base64 is the documented default and always safe to decode.
  if (data.encoding === 'base64') {
    // atob → binary string of bytes → decode as utf-8.
    const binary = atob(data.content.replace(/\n/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  }
  return data.content as string
}

// SHA-1 git blob hash, computed client-side so we can skip uploading unchanged
// content. Algorithm: SHA-1 of  `blob {byteLength}\0{content}`.
export async function gitBlobSha(content: string): Promise<string> {
  const contentBytes = new TextEncoder().encode(content)
  const header = new TextEncoder().encode(`blob ${contentBytes.byteLength}\0`)
  const buf = new Uint8Array(header.byteLength + contentBytes.byteLength)
  buf.set(header, 0)
  buf.set(contentBytes, header.byteLength)
  const hash = await crypto.subtle.digest('SHA-1', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DeviceFlowError('aborted', 'Aborted'))
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DeviceFlowError('aborted', 'Aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
