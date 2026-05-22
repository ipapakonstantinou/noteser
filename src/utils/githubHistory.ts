// File-scoped commit history. The Git Data API endpoints `GET
// /repos/{owner}/{repo}/commits?path=…` and `GET
// /repos/{owner}/{repo}/contents/{path}?ref=…` together let us show the
// list of commits that touched ONE file plus reconstruct the file's
// content at any commit. Both are CORS-friendly with Bearer auth — same
// shape every other helper in github.ts uses.
//
// We DON'T proxy these through /api/github/* because there's no CORS
// reason to. The user's token lives in the browser already.

import { githubFetch } from './githubFetch'
import { ensureOk } from './github'

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

export interface FileCommitEntry {
  /** Commit SHA — opaque, use as the `ref` for content lookups. */
  sha: string
  /** Short 7-char SHA suitable for human display. */
  shortSha: string
  /** First line of the commit message (subject). */
  message: string
  /** Author display name. */
  authorName: string
  /** ISO-8601 timestamp the author wrote in the commit. */
  authorDate: string
  /** Direct GitHub web URL for this commit. */
  htmlUrl: string
}

/**
 * List commits that touched a specific file path, newest first.
 *
 * Returns at most `perPage` entries (clamped to GitHub's max of 100).
 * The default 30 mirrors GitHub's own UI's "Show history" pagination.
 * Throws GitHubAPIError on non-2xx responses — caller catches and
 * surfaces a UI error.
 */
export async function listFileCommits(
  token: string,
  owner: string,
  repo: string,
  path: string,
  opts: { perPage?: number } = {},
): Promise<FileCommitEntry[]> {
  const perPage = Math.min(Math.max(opts.perPage ?? 30, 1), 100)
  // Path is encoded so spaces / unicode round-trip. Branch is NOT
  // pinned — we want every commit that touched this file across
  // the repo's history, not just the current branch.
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=${perPage}`
  const res = await githubFetch(url, { headers: GH_HEADERS(token) })
  await ensureOk(res, `List file commits (${path})`)
  const raw = await res.json() as Array<{
    sha: string
    commit: {
      message: string
      author: { name: string; date: string }
    }
    html_url: string
  }>
  return raw.map(c => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: (c.commit.message ?? '').split('\n', 1)[0],
    authorName: c.commit.author?.name ?? '(unknown)',
    authorDate: c.commit.author?.date ?? '',
    htmlUrl: c.html_url,
  }))
}

/**
 * List the most recent commits on a branch, newest first. Used by the
 * Source Control panel's "Recent commits" section to show what was
 * just pushed without leaving the app. Identical wire shape to
 * listFileCommits — same FileCommitEntry rows, just unfiltered.
 */
export async function listRecentCommits(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  opts: { perPage?: number } = {},
): Promise<FileCommitEntry[]> {
  const perPage = Math.min(Math.max(opts.perPage ?? 15, 1), 100)
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`
  const res = await githubFetch(url, { headers: GH_HEADERS(token) })
  await ensureOk(res, 'List recent commits')
  const raw = await res.json() as Array<{
    sha: string
    commit: {
      message: string
      author: { name: string; date: string }
    }
    html_url: string
  }>
  return raw.map(c => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: (c.commit.message ?? '').split('\n', 1)[0],
    authorName: c.commit.author?.name ?? '(unknown)',
    authorDate: c.commit.author?.date ?? '',
    htmlUrl: c.html_url,
  }))
}

/**
 * Fetch a file's content at a specific commit. Uses the contents
 * endpoint with `ref={commitSha}` — returns the file as base64 + we
 * decode to UTF-8 ourselves. Caller-friendly: returns the plaintext
 * string ready to drop into a note.
 *
 * Throws GitHubAPIError on non-2xx. Returns the empty string when the
 * file existed at that commit but was zero bytes (rare).
 */
export async function getFileContentAtCommit(
  token: string,
  owner: string,
  repo: string,
  path: string,
  commitSha: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(commitSha)}`
  const res = await githubFetch(url, { headers: GH_HEADERS(token) })
  await ensureOk(res, `Get file content at commit (${path}@${commitSha.slice(0, 7)})`)
  const data = await res.json() as { encoding?: string; content?: string }
  if (data.encoding === 'base64' && typeof data.content === 'string') {
    // GitHub line-wraps base64. atob can't handle the newlines.
    const cleaned = data.content.replace(/\n/g, '')
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  }
  // Unexpected — the contents endpoint always returns base64 for blobs.
  // Fall back to whatever string we got rather than throwing, since
  // the caller can at least display something.
  return typeof data.content === 'string' ? data.content : ''
}

/**
 * Relative-time formatter for the file-history UI. Same buckets as
 * the rest of the app's "just now" / "5m ago" copy. ISO-8601 input.
 * Empty input → empty string (defensive).
 */
export function formatRelativeAuthorDate(iso: string, now = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = now - t
  if (diff < 0) return 'just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.floor(day / 365)
  return `${yr}y ago`
}
