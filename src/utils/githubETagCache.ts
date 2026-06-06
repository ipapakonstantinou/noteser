// ETag-based conditional-request cache for GitHub Git Data reads.
//
// Why: blob / tree reads are content-addressable on their SHA, but a noteser
// session re-reads the same SHAs every sync (each pull walks the recursive
// tree, then fetches blobs for every file the user touched). The auth'd
// REST budget is 5 000 req/hr; on a large vault the first few syncs can
// burn through it fast. Sending `If-None-Match: <etag>` lets unchanged
// reads come back as a 1-byte 304 the SDK reuses from the local cache.
//
// What's cached:
//   - The ETag GitHub returned on the last 200 for a given (repo, sha) key.
//   - The decoded content the SDK returned for that same key, so a 304
//     reply can be answered from cache without a follow-up request.
//
// Layout: two-tier cache. The in-memory `Map` is the hot path (a sync that
// re-reads the same blob twice in the same tab pays nothing); the
// `idb-keyval`-backed store survives a reload so the next session also
// starts warm. Both layers are keyed by the same `repo:sha` string so the
// cache for one vault never collides with another.
//
// Pull-only (#69 scope): the wrappers in this module are consumed by
// `syncPull.ts` only. `syncPush.ts` still calls the bare `getBlobContent` /
// `getTreeMap` from `github.ts` so push semantics are byte-identical to
// pre-PR. The cache is read-side only and read-side semantics are
// transparent: a 304 returns the same content a 200 would have.

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { SyncRepo } from '@/types'
import {
  getBlobContent as rawGetBlobContent,
  getTreeMap as rawGetTreeMap,
  ensureOk,
  GitHubAPIError,
} from './github'
import { githubFetch } from './githubFetch'

// Entry shape persisted to IDB + held in memory. `content` is always the
// decoded form the caller would have received from a fresh fetch (UTF-8
// blob body / Map<path, sha> for trees), so a cache hit can short-circuit
// without re-parsing.
interface BlobCacheEntry { etag: string; content: string }
interface TreeCacheEntry { etag: string; tree: Array<[string, string]> }

// In-memory tier. Keys are `${owner}/${name}:${sha}` — see `keyFor`.
const memBlobCache = new Map<string, BlobCacheEntry>()
const memTreeCache = new Map<string, TreeCacheEntry>()

// IDB key prefix. Keeping `noteser:gh-etag:` on the front means resets that
// wipe noteser-prefixed IDB keys also drop the ETag cache — no stale
// content survives a "Wipe vault" or a future reset path.
const IDB_BLOB_PREFIX = 'noteser:gh-etag:blob:'
const IDB_TREE_PREFIX = 'noteser:gh-etag:tree:'

function keyFor(owner: string, name: string, sha: string): string {
  return `${owner}/${name}:${sha}`
}

// Common headers for an authenticated read. Same format as `github.ts`'
// `GH_HEADERS`; we duplicate the literal rather than reach into github.ts'
// internals because that helper is module-private over there.
function readHeaders(token: string, ifNoneMatch?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (ifNoneMatch) h['If-None-Match'] = ifNoneMatch
  return h
}

// ── Blob cache ──────────────────────────────────────────────────────────────

async function readBlobCache(owner: string, name: string, sha: string): Promise<BlobCacheEntry | null> {
  const key = keyFor(owner, name, sha)
  const hot = memBlobCache.get(key)
  if (hot) return hot
  try {
    const cold = await idbGet(IDB_BLOB_PREFIX + key) as BlobCacheEntry | undefined
    if (cold) {
      memBlobCache.set(key, cold)
      return cold
    }
  } catch {
    // IDB unavailable (private mode, test env without the mock) — fall
    // through to a network read. Not fatal.
  }
  return null
}

async function writeBlobCache(owner: string, name: string, sha: string, entry: BlobCacheEntry): Promise<void> {
  const key = keyFor(owner, name, sha)
  memBlobCache.set(key, entry)
  try {
    await idbSet(IDB_BLOB_PREFIX + key, entry)
  } catch {
    // IDB write fails (quota / mode) — the in-memory tier still serves
    // this session. Not fatal.
  }
}

// Cached blob fetch. Behaviour-identical to `getBlobContent` from
// `github.ts` modulo the cache: on a cache miss we delegate to the bare
// helper (so any caller that mocks `github.ts` still intercepts the read);
// on a cache hit we issue a conditional fetch and short-circuit on 304;
// on a 200 reply we store the new ETag + decoded content. Returns raw
// decoded blob content as a string (UTF-8) — same return shape as the
// bare helper.
export async function getBlobContentConditional(
  token: string,
  repo: SyncRepo,
  sha: string,
): Promise<string> {
  const { owner, name } = repo
  const cached = await readBlobCache(owner, name, sha)

  // Cold cache: delegate to the bare helper. We still want the *next* call
  // to send `If-None-Match`, but we cannot derive an ETag from the bare
  // helper's return value (it parses + decodes the body before we see it),
  // so the first read just warms the in-memory `content` half — the ETag
  // half stays cold. The very next call then issues a conditional fetch
  // and on success populates the ETag too. (Most production reads see at
  // least two passes per session: one from the initial sync, one from a
  // later auto-sync — so the ETag does land in practice.)
  if (!cached) {
    const content = await rawGetBlobContent(token, owner, name, sha)
    // Stash the content-only entry under an empty-etag sentinel so the
    // hot path can still answer a second same-session read from memory.
    // The ETag stays empty; the next attempt will go through the
    // conditional branch below and populate it on a 200 response.
    memBlobCache.set(keyFor(owner, name, sha), { etag: '', content })
    return content
  }

  // Hot cache with an ETag → conditional fetch. The empty-etag sentinel
  // above will skip this branch and re-delegate; only an entry that
  // carried a real ETag through a previous 200 enters here.
  if (!cached.etag) {
    const content = await rawGetBlobContent(token, owner, name, sha)
    memBlobCache.set(keyFor(owner, name, sha), { etag: '', content })
    return content
  }

  const headers = readHeaders(token, cached.etag)
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${name}/git/blobs/${sha}`,
    { headers },
  )

  if (res.status === 304) {
    // Unchanged — reuse the cached body. Drain the (empty) body so the
    // browser doesn't keep the connection in a half-open state.
    try { await res.text() } catch { /* ignore */ }
    return cached.content
  }

  if (!res.ok) {
    throw await GitHubAPIError.fromResponse(res, `Read blob ${sha}`)
  }

  const data = await res.json()
  let content: string
  if (data.encoding === 'base64') {
    // Same decode as `getBlobContent` in github.ts.
    const binary = atob(String(data.content).replace(/\n/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    content = new TextDecoder('utf-8').decode(bytes)
  } else {
    content = data.content as string
  }

  const etag = res.headers.get('etag')
  if (etag) {
    await writeBlobCache(owner, name, sha, { etag, content })
  } else {
    // Server didn't send an ETag — clear the stale one rather than keep a
    // sentinel that would try to send `If-None-Match: <old>` next time.
    memBlobCache.set(keyFor(owner, name, sha), { etag: '', content })
  }
  return content
}

// ── Tree cache ──────────────────────────────────────────────────────────────

async function readTreeCache(owner: string, name: string, treeSha: string): Promise<TreeCacheEntry | null> {
  const key = keyFor(owner, name, treeSha)
  const hot = memTreeCache.get(key)
  if (hot) return hot
  try {
    const cold = await idbGet(IDB_TREE_PREFIX + key) as TreeCacheEntry | undefined
    if (cold) {
      memTreeCache.set(key, cold)
      return cold
    }
  } catch {
    // Same recovery as the blob path — fall through to network.
  }
  return null
}

async function writeTreeCache(owner: string, name: string, treeSha: string, entry: TreeCacheEntry): Promise<void> {
  const key = keyFor(owner, name, treeSha)
  memTreeCache.set(key, entry)
  try {
    await idbSet(IDB_TREE_PREFIX + key, entry)
  } catch {
    // Quota / unavailable — leave in-memory only.
  }
}

// Cached recursive tree read. Same shape as `getTreeMap` in github.ts
// (Map<path, blobSha>), with conditional-request handling on top. Trees
// are referenced by their own SHA, so a cache hit is unambiguous — the
// SHA being the same guarantees the response is byte-identical.
//
// Same delegation strategy as the blob cache: cold misses (or entries
// whose ETag was never captured) go through the bare `getTreeMap` so any
// test mocking `github.ts` still intercepts the read. A subsequent call
// with a populated ETag issues the conditional fetch directly.
export async function getTreeMapConditional(
  token: string,
  repo: SyncRepo,
  treeSha: string,
): Promise<Map<string, string>> {
  const { owner, name } = repo
  const cached = await readTreeCache(owner, name, treeSha)

  if (!cached || !cached.etag) {
    const tree = await rawGetTreeMap(token, owner, name, treeSha)
    memTreeCache.set(keyFor(owner, name, treeSha), { etag: '', tree: Array.from(tree.entries()) })
    return tree
  }

  const headers = readHeaders(token, cached.etag)
  const res = await githubFetch(
    `https://api.github.com/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`,
    { headers },
    // Same generous timeout the bare helper uses — large vaults can take
    // a while to serialise + transfer.
    { timeoutMs: 90_000 },
  )

  if (res.status === 304) {
    try { await res.text() } catch { /* ignore */ }
    return new Map<string, string>(cached.tree)
  }

  if (!res.ok) {
    await ensureOk(res, 'Read tree')
  }

  const data = await res.json()
  const out = new Map<string, string>()
  for (const entry of data.tree as Array<{ path: string; type: string; sha: string }>) {
    if (entry.type === 'blob') out.set(entry.path, entry.sha)
  }

  const etag = res.headers.get('etag')
  if (etag) {
    await writeTreeCache(owner, name, treeSha, { etag, tree: Array.from(out.entries()) })
  } else {
    memTreeCache.set(keyFor(owner, name, treeSha), { etag: '', tree: Array.from(out.entries()) })
  }
  return out
}

// ── Test / reset hooks ──────────────────────────────────────────────────────

/**
 * Drop the in-memory tier of both caches. Used by tests to reset between
 * scenarios. Does NOT touch the IDB tier — leave that to a deliberate IDB
 * cleanup if needed (in tests the IDB layer is usually mocked anyway).
 */
export function _resetETagCache(): void {
  memBlobCache.clear()
  memTreeCache.clear()
}

/**
 * Invalidate a single blob entry across both tiers — used when a caller
 * wants to force the next read to bypass the cache (e.g. after a manual
 * "discard local + re-clone" the saved ETag for the stale sha is no
 * longer trustworthy). Best-effort on the IDB side.
 */
export async function invalidateBlobETag(owner: string, name: string, sha: string): Promise<void> {
  const key = keyFor(owner, name, sha)
  memBlobCache.delete(key)
  try {
    await idbDel(IDB_BLOB_PREFIX + key)
  } catch {
    // Best-effort.
  }
}

/**
 * Invalidate a single tree entry across both tiers. Same rationale as
 * `invalidateBlobETag`.
 */
export async function invalidateTreeETag(owner: string, name: string, treeSha: string): Promise<void> {
  const key = keyFor(owner, name, treeSha)
  memTreeCache.delete(key)
  try {
    await idbDel(IDB_TREE_PREFIX + key)
  } catch {
    // Best-effort.
  }
}
