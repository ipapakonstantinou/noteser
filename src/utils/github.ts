import type { GitHubUser, GitHubRepo } from '@/types'
import type { GitHubTokenSet } from '@/stores/githubStore'
import { githubFetch } from './githubFetch'

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

// Typed error thrown by every Git Data API helper below. Carries the HTTP
// status, the GitHub error message (when the body parses as JSON), and any
// rate-limit metadata so the UI can show a precise message instead of
// "Failed to read tree (403)".
export class GitHubAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly operation: string,
    public readonly githubMessage: string | null,
    public readonly rateLimitReset: number | null,
    public readonly remaining: number | null,
  ) {
    const tail = githubMessage ? ` — ${githubMessage}` : ''
    super(`${operation} failed (${status})${tail}`)
    this.name = 'GitHubAPIError'
  }

  /** True when this looks like a primary or secondary GitHub rate-limit hit. */
  get isRateLimit(): boolean {
    if (this.status === 429) return true
    if (this.status === 403 && this.remaining === 0) return true
    return false
  }

  /** Human-readable countdown until the rate-limit window resets. */
  resetInSeconds(now = Date.now()): number | null {
    if (this.rateLimitReset == null) return null
    const ms = this.rateLimitReset * 1000 - now
    return ms > 0 ? Math.ceil(ms / 1000) : 0
  }

  // Build from a non-ok Response. Best-effort: tries to read the JSON body
  // for a "message" field, falls back to null. Always consumes the body.
  static async fromResponse(res: Response, operation: string): Promise<GitHubAPIError> {
    let githubMessage: string | null = null
    try {
      const body = await res.clone().json() as { message?: string }
      if (typeof body.message === 'string') githubMessage = body.message
    } catch {
      // Body wasn't JSON, leave message null.
    }
    const reset = res.headers.get('x-ratelimit-reset')
    const remaining = res.headers.get('x-ratelimit-remaining')
    const resetN = reset != null ? parseInt(reset, 10) : NaN
    const remainingN = remaining != null ? parseInt(remaining, 10) : NaN
    return new GitHubAPIError(
      res.status,
      operation,
      githubMessage,
      Number.isFinite(resetN) ? resetN : null,
      Number.isFinite(remainingN) ? remainingN : null,
    )
  }
}

/** Throw if the response isn't ok. Typed so callers can `instanceof` check. */
export async function ensureOk(res: Response, operation: string): Promise<void> {
  if (res.ok) return
  throw await GitHubAPIError.fromResponse(res, operation)
}

// ── Step 1: ask the proxy to request a device code from GitHub ──────────────
//
// `scope` is optional. Omit it for normal sign-in (proxy defaults to
// `repo`). Pass `'repo gist'` when the user has explicitly opted into a
// scope upgrade — currently only the "Publish as gist" first-use flow.
// The proxy validates against an allow-list, so any other value is
// silently downgraded to `repo`.
export async function startDeviceFlow(scope?: 'repo' | 'repo gist'): Promise<DeviceFlowStart> {
  const init: RequestInit = scope
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      }
    : { method: 'POST' }
  const res = await githubFetch('/api/github/device-code', init)
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

// Raw shape of GitHub's OAuth token-endpoint JSON. `expires_in` /
// `refresh_token` / `refresh_token_expires_in` are present ONLY when the app
// issues expiring user tokens; for non-expiring tokens only `access_token`
// comes back.
interface RawTokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
}

// Normalise a raw OAuth token response into our persisted GitHubTokenSet.
// `expires_in` is a relative lifetime in seconds; we convert it to an absolute
// epoch-ms instant against `now` so expiry checks are clock-comparison only.
// When the response carries NO `expires_in` / `refresh_token` (PATs, classic
// non-expiring OAuth tokens) the expiry/refresh fields stay null and the
// renewal layer treats the token as never-expiring.
export function toTokenSet(raw: RawTokenResponse, now = Date.now()): GitHubTokenSet | null {
  if (!raw.access_token) return null
  const accessTokenExpiresAt =
    typeof raw.expires_in === 'number' && raw.expires_in > 0
      ? now + raw.expires_in * 1000
      : null
  const refreshTokenExpiresAt =
    typeof raw.refresh_token_expires_in === 'number' && raw.refresh_token_expires_in > 0
      ? now + raw.refresh_token_expires_in * 1000
      : null
  return {
    accessToken: raw.access_token,
    accessTokenExpiresAt,
    refreshToken: typeof raw.refresh_token === 'string' ? raw.refresh_token : null,
    refreshTokenExpiresAt,
  }
}

// ── Step 2: poll the proxy until the user authorizes or the code expires ────
// Returns the FULL token set (not just the access token) so the caller can
// persist an expiring token's refresh_token + expiry. For a non-expiring token
// the extra fields come back null (see toTokenSet) and the caller stores a bare
// access token exactly as before.
export async function pollForToken({ deviceCode, interval, expiresIn, signal }: PollOptions): Promise<GitHubTokenSet> {
  const deadline = Date.now() + expiresIn * 1000
  let currentInterval = interval

  while (Date.now() < deadline) {
    if (signal.aborted) throw new DeviceFlowError('aborted', 'Polling aborted')
    await sleep(currentInterval * 1000, signal)

    const res = await githubFetch('/api/github/access-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    })
    const json = await res.json().catch(() => ({})) as RawTokenResponse & { error?: string; error_description?: string }

    if (json.access_token) {
      const tokenSet = toTokenSet(json)
      // access_token was truthy so toTokenSet cannot return null here, but the
      // type guard keeps TS honest.
      if (tokenSet) return tokenSet
    }

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

// ── Refresh-token exchange ──────────────────────────────────────────────────
// Thrown when a refresh attempt fails terminally (refresh token expired,
// revoked, or otherwise rejected by GitHub). The caller maps this to the
// existing reconnect flow — there is no point retrying.
export class RefreshTokenError extends Error {
  constructor(public code: 'invalid' | 'config' | 'network' | 'rate_limited', message: string) {
    super(message)
    this.name = 'RefreshTokenError'
  }
}

// Exchange a refresh_token for a fresh token set via the stateless proxy.
// GitHub rotates the refresh_token on every use, so the returned set carries a
// NEW refresh_token the caller must persist (applyRefreshedTokens does this).
// Throws RefreshTokenError on any terminal failure so the caller can fall back
// to a full reconnect instead of looping.
export async function refreshAccessToken(refreshToken: string): Promise<GitHubTokenSet> {
  let res: Response
  try {
    res = await githubFetch('/api/github/refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  } catch (err) {
    throw new RefreshTokenError('network', err instanceof Error ? err.message : 'Network error during token refresh')
  }

  const json = await res.json().catch(() => ({})) as RawTokenResponse & { error?: string; error_description?: string }

  if (json.access_token) {
    const tokenSet = toTokenSet(json)
    if (tokenSet) return tokenSet
  }

  // Map GitHub's documented refresh errors to a typed failure. `bad_refresh_token`
  // and `bad_verification_code` mean the refresh token is no longer valid →
  // reconnect. Everything else is surfaced with whatever GitHub said.
  switch (json.error) {
    case 'missing_client_id':
      throw new RefreshTokenError('config', 'GitHub Client ID not configured.')
    case 'rate_limited':
      throw new RefreshTokenError('rate_limited', json.error_description ?? 'Refresh rate-limited. Please retry shortly.')
    case 'bad_refresh_token':
    case 'bad_verification_code':
    case 'unauthorized':
      throw new RefreshTokenError('invalid', json.error_description ?? 'Refresh token is no longer valid. Please reconnect.')
    default:
      throw new RefreshTokenError('invalid', json.error_description ?? json.error ?? `Token refresh failed (${res.status})`)
  }
}

// ── Step 3: use the token to fetch identifying info ─────────────────────────
export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const { user } = await fetchGitHubUserAndScopes(token)
  return user
}

// Variant of `fetchGitHubUser` that also reports the token's OAuth
// scopes, parsed from the `X-OAuth-Scopes` response header (a
// comma-separated list, e.g. `repo, gist`). Returned as a normalised
// array of trimmed lowercase strings.
//
// Used by:
//   - GitHubAuthModal sign-in / scope-upgrade flows — to remember
//     whether the just-issued token includes `gist` and avoid asking
//     again for users who already authorised it.
//   - PublishGistModal — to decide between "Publish gist" and
//     "Authorize gist publishing" without hitting the gists endpoint
//     first.
//
// If the header is missing entirely (some proxies strip it) we return
// `null` so callers can fall back to "best effort try, recover from
// GistScopeError" rather than blocking the user.
export async function fetchGitHubUserAndScopes(
  token: string,
): Promise<{ user: GitHubUser; scopes: string[] | null }> {
  const res = await githubFetch('https://api.github.com/user', {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
  })
  await ensureOk(res, 'Fetch GitHub user')
  const data = await res.json()
  const user: GitHubUser = {
    id: data.id,
    login: data.login,
    name: data.name ?? null,
    avatar_url: data.avatar_url,
  }
  return { user, scopes: parseOAuthScopesHeader(res.headers.get('x-oauth-scopes')) }
}

// Exported for unit tests. Returns null if the header is absent —
// "absent" is meaningfully different from "empty list" (the latter
// would be a token with no scopes, which GitHub does issue for
// "public-only" reads).
export function parseOAuthScopesHeader(raw: string | null): string[] | null {
  if (raw == null) return null
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0)
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
    const res = await githubFetch(url, { headers: GH_HEADERS(token) })
    await ensureOk(res, 'List repos')
    const batch: GitHubRepo[] = await res.json()
    out.push(...batch)
    if (batch.length < PER_PAGE) break
  }
  return out
}

export async function listRepoBranches(token: string, owner: string, repo: string): Promise<{ name: string }[]> {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    { headers: GH_HEADERS(token) },
  )
  await ensureOk(res, 'List branches')
  return res.json()
}

export async function getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: GH_HEADERS(token) },
  )
  await ensureOk(res, 'Fetch repo')
  return res.json()
}

// Creates a new repo under the authenticated user. `auto_init: true` gives
// the repo an initial commit so the default branch exists immediately.
export async function createRepo(
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<GitHubRepo> {
  const res = await githubFetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      private: isPrivate,
      auto_init: true,
      description: 'Noteser vault',
    }),
  })
  await ensureOk(res, 'Create repo')
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
  // GitHub's API responses for ref reads pass through caching layers that
  // can hand back a stale SHA for ~60s after a push. If we use a stale SHA
  // as the parent of a new commit, the subsequent `updateBranchRef` PATCH
  // is rejected as "Update is not a fast forward".
  //
  // We can't send `Cache-Control: no-cache` — it isn't on the CORS-safelist
  // and GitHub's preflight doesn't allow it. Instead we cache-bust the URL
  // with a timestamp; GitHub ignores unknown query params, but any cache in
  // the path keys on the URL and so always misses.
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}?_=${Date.now()}`
  const res = await githubFetch(url, { headers: GH_HEADERS(token), cache: 'no-store' })
  await ensureOk(res, 'Read ref')
  const data = await res.json()
  // The `/refs/heads/{branch}` endpoint returns an array when the supplied
  // path is a prefix match for multiple refs (e.g. `main` matching both
  // `main` and `main-foo`). Pick the exact match in that case.
  if (Array.isArray(data)) {
    const exact = data.find((d) => d.ref === `refs/heads/${branch}`)
    if (!exact) throw new Error(`Branch ${branch} not found`)
    return exact.object.sha
  }
  return data.object.sha
}

export async function getCommitTreeSha(token: string, owner: string, repo: string, commitSha: string): Promise<string> {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`,
    { headers: GH_HEADERS(token) },
  )
  await ensureOk(res, 'Read commit')
  const data = await res.json()
  return data.tree.sha
}

// Map of repo path → existing blob SHA (only blob entries, not subtrees).
export async function getTreeMap(token: string, owner: string, repo: string, treeSha: string): Promise<Map<string, string>> {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    { headers: GH_HEADERS(token) },
    // Recursive tree of a large vault can be a sizeable payload that takes a
    // while to serialise/transfer — give it a generous 90s bound so it is
    // never aborted by the default per-request timeout mid-fetch.
    { timeoutMs: 90_000 },
  )
  await ensureOk(res, 'Read tree')
  const data = await res.json()
  const out = new Map<string, string>()
  for (const entry of data.tree as Array<{ path: string; type: string; sha: string }>) {
    if (entry.type === 'blob') out.set(entry.path, entry.sha)
  }
  return out
}

export async function createBlob(token: string, owner: string, repo: string, content: string): Promise<string> {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
    {
      method: 'POST',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    },
  )
  await ensureOk(res, 'Create blob')
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
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: 'POST',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
    },
  )
  await ensureOk(res, 'Create tree')
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
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
    },
  )
  await ensureOk(res, 'Create commit')
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
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: 'PATCH',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: commitSha, force: false }),
    },
  )
  await ensureOk(res, 'Update branch ref')
}

// Download the repo as a zip archive at a given ref via our own proxy route.
// We can't hit api.github.com's zipball endpoint directly from the browser:
// GitHub returns a 302 to codeload.github.com which strips Authorization on
// the cross-origin redirect and doesn't set CORS headers on its responses,
// so the browser rejects the chain. The Next.js route at /api/github/zipball
// performs the fetch server-side and streams the bytes back.
//
// One archive download replaces what would otherwise be one blob fetch per
// file when seeding a vault from scratch. The trade-off is up-front memory
// (the whole archive lives in an ArrayBuffer before JSZip parses it), but
// for typical vaults (≤100 MB) that's well within browser limits.
export async function fetchZipball(token: string, owner: string, repo: string, ref: string): Promise<ArrayBuffer> {
  const res = await githubFetch('/api/github/zipball', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo, ref }),
  },
  // The full-repo archive is the single biggest download in the whole sync —
  // on a large vault it can legitimately take minutes. This was the regression
  // the 20s default introduced: the initial clone exceeded it and the timeout
  // aborted the download. Give it a 3-minute bound so it is never cut off
  // mid-transfer; the whole-sync watchdog (in useGitHubSync) is the real upper
  // bound for a stalled connection here.
  { timeoutMs: 180_000 })
  await ensureOk(res, 'Download zipball')
  const buffer = await res.arrayBuffer()
  // Truncation guard: on a flaky mobile connection the archive sometimes
  // arrives short, and JSZip then throws "can't find end of central
  // directory". When the response advertises a Content-Length we can detect
  // the short read up front and throw so the caller's retry loop re-downloads
  // instead of failing the whole sync. A missing/0 header means we can't tell
  // (chunked transfer, proxy stripped it) — fall through and let JSZip be the
  // judge.
  const declared = res.headers.get('content-length')
  if (declared != null) {
    const expected = parseInt(declared, 10)
    if (Number.isFinite(expected) && expected > 0 && buffer.byteLength !== expected) {
      throw new Error(
        `Truncated zipball download: received ${buffer.byteLength} bytes, expected ${expected}`,
      )
    }
  }
  return buffer
}

// Fetch a blob's content by SHA. GitHub returns it base64-encoded.
export async function getBlobContent(token: string, owner: string, repo: string, sha: string): Promise<string> {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers: GH_HEADERS(token) },
  )
  await ensureOk(res, `Read blob ${sha}`)
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
  return gitBlobShaBytes(contentBytes)
}

// Binary variant of gitBlobSha. Same algorithm — `blob {byteLength}\0{bytes}`
// SHA-1'd — but lets the caller pass arbitrary bytes (e.g. an image file)
// without forcing a text encode that would mangle the content.
export async function gitBlobShaBytes(bytes: Uint8Array): Promise<string> {
  // crypto.subtle only exists in a "secure context" — HTTPS or localhost.
  // If a user opens the dev server over http://192.168.x.x from another PC,
  // the browser refuses to expose it and the next line crashes with the
  // cryptic "Cannot read properties of undefined (reading 'digest')". Detect
  // the missing API up front and throw a message the UI can show verbatim.
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'Web Crypto API unavailable — GitHub sync needs a secure context. ' +
      'Open Noteser via https:// (use the deployed URL) or via http://localhost ' +
      '(not the LAN IP). See docs/release-process.md → "LAN access".',
    )
  }
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`)
  const buf = new Uint8Array(header.byteLength + bytes.byteLength)
  buf.set(header, 0)
  buf.set(bytes, header.byteLength)
  const hash = await crypto.subtle.digest('SHA-1', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Encode a Blob's bytes as a base64 string, suitable for GitHub's
// `POST /git/blobs` with `encoding: 'base64'`. Uses FileReader's
// readAsDataURL so we don't blow the JS call stack on large files
// (String.fromCharCode(...big_array) is not safe).
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned non-string for data URL'))
        return
      }
      // data:<mime>;base64,<payload>
      const commaIdx = result.indexOf(',')
      resolve(commaIdx === -1 ? '' : result.slice(commaIdx + 1))
    }
    reader.readAsDataURL(blob)
  })
}

// Decode a base64 string into raw bytes. Strips any embedded newlines that
// GitHub may add to its base64 payloads.
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\n/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Upload a Blob as a base64-encoded git blob. Returns the SHA GitHub
// assigned to the new blob (matches the SHA we'd compute via
// gitBlobShaBytes locally — useful for sanity checks).
export async function createBlobBinary(
  token: string,
  owner: string,
  repo: string,
  blob: Blob,
): Promise<string> {
  const base64 = await blobToBase64(blob)
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
    {
      method: 'POST',
      headers: { ...GH_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: base64, encoding: 'base64' }),
    },
  )
  await ensureOk(res, 'Create binary blob')
  const data = await res.json()
  return data.sha as string
}

// Fetch a blob's raw bytes by SHA. GitHub returns it base64-encoded for
// binary content; we decode straight into a Uint8Array so the caller can
// wrap it as a Blob with the correct MIME.
export async function getBlobBytes(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<Uint8Array> {
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers: GH_HEADERS(token) },
  )
  await ensureOk(res, `Read binary blob ${sha}`)
  const data = await res.json()
  if (data.encoding === 'base64') return base64ToBytes(data.content)
  // Unexpected — UTF-8 encoding on a binary blob would corrupt non-ASCII
  // bytes. Re-encode and surface the issue rather than silently corrupting.
  throw new Error(`Unexpected blob encoding for binary fetch: ${data.encoding}`)
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
