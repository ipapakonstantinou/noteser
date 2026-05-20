// Thin wrapper around `fetch` for GitHub API calls. Adds two behaviours
// the bare fetch doesn't:
//   1. Exponential-backoff retry on transient failures (429, 5xx).
//   2. Honours the `Retry-After` header when GitHub sends one
//      (rate-limit responses do).
//
// Non-transient failures (auth, 404, 422, …) are returned to the caller
// untouched — they shouldn't be silently retried.

const MAX_RETRIES = 4
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 30_000

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])

interface GithubFetchOpts {
  /** Per-call retry cap. Defaults to MAX_RETRIES. */
  maxRetries?: number
  /** Hook for tests to bypass the real setTimeout. */
  delayMs?: (ms: number) => Promise<void>
}

const realDelay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function githubFetch(
  url: string | URL,
  init: RequestInit = {},
  opts: GithubFetchOpts = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES
  const delay = opts.delayMs ?? realDelay

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      // Network error (no Response object). Retry up to maxRetries.
      if (attempt >= maxRetries) throw err
      await delay(backoff(attempt))
      attempt += 1
      continue
    }

    if (!TRANSIENT_STATUSES.has(res.status)) {
      return res
    }
    if (attempt >= maxRetries) return res

    const wait = computeWait(res, attempt)
    await delay(wait)
    attempt += 1
  }
}

// Reads `Retry-After` (seconds) when present, otherwise falls back to
// exponential backoff. GitHub also sets X-RateLimit-Reset for non-429
// rate-limit hits; we honor that too when the header is there.
export function computeWait(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('retry-after')
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_DELAY_MS)
    }
  }
  const reset = res.headers.get('x-ratelimit-reset')
  if (reset) {
    const resetMs = parseInt(reset, 10) * 1000
    if (Number.isFinite(resetMs) && resetMs > Date.now()) {
      return Math.min(resetMs - Date.now(), MAX_DELAY_MS)
    }
  }
  return backoff(attempt)
}

function backoff(attempt: number): number {
  // 0.5s, 1s, 2s, 4s, … capped at MAX_DELAY_MS. Adds a small jitter
  // (±20%) so concurrent clients don't synchronise their retries.
  const base = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}
