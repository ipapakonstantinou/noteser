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

// Per-request timeout. A bare `fetch` has no timeout: on mobile (Safari, flaky
// networks) a connection can open but never respond, so the promise neither
// resolves nor rejects and the whole sync wedges (isSyncing stuck true). 20s is
// comfortably longer than a healthy request yet shorter than the 45s whole-sync
// watchdog, so a stall fails fast and the retry/backoff machinery can react.
const REQUEST_TIMEOUT_MS = 20_000

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])

// Thrown after a fetch attempt exceeds REQUEST_TIMEOUT_MS and the retries are
// exhausted. Distinct type so callers can special-case a timeout vs a generic
// network error if they want to.
export class GitHubTimeoutError extends Error {
  constructor(message = `GitHub request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`) {
    super(message)
    this.name = 'GitHubTimeoutError'
  }
}

// GitHub's *primary* rate limit returns 403 (not 429!) with
// `x-ratelimit-remaining: 0` plus an `x-ratelimit-reset` epoch. The
// *secondary* (abuse-detection) limit also returns 403 but with a
// `retry-after` header instead. Either way it's transient — wait and
// retry. See https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
function isRateLimited403(res: Response): boolean {
  if (res.status !== 403) return false
  const remaining = res.headers.get('x-ratelimit-remaining')
  if (remaining === '0') return true
  // Secondary rate limit: 403 with a Retry-After hint.
  return res.headers.has('retry-after')
}

function isTransient(res: Response): boolean {
  return TRANSIENT_STATUSES.has(res.status) || isRateLimited403(res)
}

interface GithubFetchOpts {
  /** Per-call retry cap. Defaults to MAX_RETRIES. */
  maxRetries?: number
  /** Hook for tests to bypass the real setTimeout. */
  delayMs?: (ms: number) => Promise<void>
}

const realDelay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// We need to tell two kinds of abort apart, because they surface from `fetch`
// as the same generic AbortError:
//   • a TIMEOUT abort (our internal REQUEST_TIMEOUT_MS timer) → retryable, and
//     ultimately a GitHubTimeoutError;
//   • a CALLER abort (init.signal — the watchdog or a user cancel) → must
//     propagate immediately, never retried.
// `fetchWithTimeout` tags the error it throws so the retry loop can branch.
const CALLER_ABORT = Symbol('githubFetch.callerAbort')

interface TaggedAbort {
  [CALLER_ABORT]?: true
}

function isCallerAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as TaggedAbort)[CALLER_ABORT] === true
}

function callerAbortError(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason
  const err = reason instanceof Error
    ? reason
    : Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
  Object.assign(err, { [CALLER_ABORT]: true })
  return err
}

// Run a single fetch attempt bounded by REQUEST_TIMEOUT_MS. The fetch is
// aborted when EITHER our internal timeout fires OR the caller's signal aborts.
//
// We use a manual AbortController + setTimeout rather than AbortSignal.timeout /
// AbortSignal.any because the target is mobile Safari and we need broad version
// compatibility. A fresh controller is created per attempt; the timer is always
// cleared and the caller-signal listener always removed when the fetch settles,
// to avoid leaks.
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  callerSignal: AbortSignal | null,
): Promise<Response> {
  const controller = new AbortController()
  // Track which source aborted. Both surface from `fetch` as the same generic
  // AbortError, so we record the cause in the callback that fired:
  //   timedOut       — our internal timer (retryable → GitHubTimeoutError);
  //   callerAborted  — the caller's signal (propagate immediately, no retry).
  let timedOut = false
  let callerAborted = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  const onCallerAbort = () => {
    callerAborted = true
    controller.abort()
  }
  if (callerSignal) callerSignal.addEventListener('abort', onCallerAbort, { once: true })

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    // fetch rejected. If our controller did the aborting, classify the source.
    if (controller.signal.aborted) {
      // Caller cancellation wins over a timeout in the rare both-fired race:
      // the caller explicitly asked to stop, so honour it (propagate, no retry).
      if (callerAborted) {
        throw callerAbortError(callerSignal!)
      }
      if (timedOut) {
        throw new GitHubTimeoutError()
      }
      // Aborted but neither flag set — shouldn't happen, but be safe.
      throw new GitHubTimeoutError()
    }
    // Some other network error (DNS, connection reset, …). Bubble up untagged
    // so the retry loop treats it as transient.
    throw err
  } finally {
    clearTimeout(timer)
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort)
  }
}

export async function githubFetch(
  url: string | URL,
  init: RequestInit = {},
  opts: GithubFetchOpts = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES
  const delay = opts.delayMs ?? realDelay

  const callerSignal = init.signal ?? null
  // If the caller already cancelled before we even start, honour it. This is a
  // caller abort (not a timeout), so propagate immediately without retrying.
  if (callerSignal?.aborted) {
    throw callerAbortError(callerSignal)
  }

  let attempt = 0
  for (;;) {
    let res: Response
    try {
      res = await fetchWithTimeout(url, init, callerSignal)
    } catch (err) {
      // A caller abort (init.signal — the watchdog or a user cancel) must NOT
      // be retried: rethrow so the cancellation is honoured immediately.
      if (isCallerAbort(err)) throw err
      // A timeout abort (our internal timer) or any other network error has no
      // Response object — treat it like a transient failure and retry up to
      // maxRetries, then surface a clear timeout error.
      if (attempt >= maxRetries) throw err
      await delay(backoff(attempt))
      attempt += 1
      continue
    }

    // Capture rate-limit headers for telemetry on every response that
    // carries them — both successes and transient errors.
    recordRateLimitFromResponse(res)

    if (!isTransient(res)) {
      return res
    }
    if (attempt >= maxRetries) return res

    const wait = computeWait(res, attempt)
    await delay(wait)
    attempt += 1
  }
}

// ── Rate-limit telemetry ────────────────────────────────────────────────────
// GitHub returns x-ratelimit-{limit,remaining,reset,used,resource} on most
// API responses. We snapshot the most recent values so the UI can show
// "You have N requests left this hour" without an extra round-trip.

export interface RateLimitSnapshot {
  /** Total quota for the resource this window. */
  limit: number
  /** Requests left until reset. */
  remaining: number
  /** Epoch seconds when the window resets. */
  reset: number
  /** Resource bucket — `core`, `search`, `graphql`, etc. */
  resource: string
  /** When we captured this (client clock, epoch ms). */
  capturedAt: number
}

let lastRateLimit: RateLimitSnapshot | null = null
const listeners = new Set<(snap: RateLimitSnapshot) => void>()

function recordRateLimitFromResponse(res: Response): void {
  const limit = res.headers.get('x-ratelimit-limit')
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = res.headers.get('x-ratelimit-reset')
  if (limit == null || remaining == null || reset == null) return
  const limitN = parseInt(limit, 10)
  const remainingN = parseInt(remaining, 10)
  const resetN = parseInt(reset, 10)
  if (!Number.isFinite(limitN) || !Number.isFinite(remainingN) || !Number.isFinite(resetN)) return
  const snap: RateLimitSnapshot = {
    limit: limitN,
    remaining: remainingN,
    reset: resetN,
    resource: res.headers.get('x-ratelimit-resource') ?? 'core',
    capturedAt: Date.now(),
  }
  lastRateLimit = snap
  for (const l of listeners) {
    try { l(snap) } catch { /* listener errors must not break fetches */ }
  }
}

/** Most recent rate-limit snapshot, or null if we haven't seen one yet. */
export function getLastRateLimit(): RateLimitSnapshot | null {
  return lastRateLimit
}

/** Subscribe to rate-limit updates. Returns the unsubscribe function. */
export function onRateLimit(listener: (snap: RateLimitSnapshot) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Reset state — for tests only. */
export function _resetRateLimitTelemetry(): void {
  lastRateLimit = null
  listeners.clear()
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
