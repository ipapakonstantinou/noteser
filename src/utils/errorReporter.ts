// Client-side global error capture. Sends uncaught exceptions and
// unhandled promise rejections to /api/errors, where they land in
// Vercel Runtime Logs.
//
// Boot order matters: install handlers as early as possible so we
// catch errors thrown during React hydration (the most painful kind
// to debug otherwise). See `src/app/layout.tsx` or a top-level
// `useEffect` that calls `installErrorReporter()`.
//
// Idempotent: calling installErrorReporter() more than once is safe.
// Per-page-load dedup limits the same error firing in a loop to one
// POST per minute.

const SEND_PATH = '/api/errors'
const MIN_RESEND_MS = 60_000

let installed = false
const recentByKey = new Map<string, number>()

interface ErrorPayload {
  kind: 'error' | 'rejection'
  message: string
  stack?: string
  pathname?: string
  ua?: string
  buildId?: string
  ts?: number
  pluginId?: string
}

export function installErrorReporter(): void {
  if (installed) return
  if (typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (ev: ErrorEvent) => {
    maybeOfferReload(ev.error ?? ev.message)
    send({
      kind: 'error',
      message: ev.message || (ev.error?.message ?? 'Unknown error'),
      stack: ev.error?.stack,
    })
  })

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason
    maybeOfferReload(reason)
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : safeStringify(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    send({ kind: 'rejection', message, stack })
  })
}

/**
 * Send an error report directly, e.g. from a try/catch path that
 * already swallowed the error but wants to surface it.
 */
export function reportError(
  err: unknown,
  context: { pluginId?: string } = {},
): void {
  const e = err instanceof Error ? err : new Error(safeStringify(err))
  send({ kind: 'error', message: e.message, stack: e.stack, pluginId: context.pluginId })
}

// Stale-deploy chunk failures get a user-facing "Reload" toast on top of
// the log entry: retrying the import can never work (the hashed file is
// gone from the CDN), so without this the user is stuck on a dead button.
// Dynamic import so the reporter itself stays dependency-free at boot.
function maybeOfferReload(reason: unknown): void {
  void import('./chunkLoadError').then(({ isChunkLoadError, showChunkReloadToast }) => {
    if (isChunkLoadError(reason)) showChunkReloadToast()
  }).catch(() => {
    // If even this chunk fails to load we cannot toast; the log entry
    // from send() is still emitted.
  })
}

function send(payload: Pick<ErrorPayload, 'kind' | 'message' | 'stack' | 'pluginId'>): void {
  if (typeof window === 'undefined') return

  const key = `${payload.kind}|${payload.message.slice(0, 200)}|${(payload.stack ?? '').slice(0, 200)}`
  const now = Date.now()
  const last = recentByKey.get(key)
  if (last !== undefined && now - last < MIN_RESEND_MS) return
  recentByKey.set(key, now)
  // Cap the dedup map at 50 entries so a noisy page does not leak.
  if (recentByKey.size > 50) {
    const oldest = [...recentByKey.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest) recentByKey.delete(oldest[0])
  }

  const body: ErrorPayload = {
    ...payload,
    pathname: window.location.pathname,
    ua: navigator.userAgent.slice(0, 256),
    buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? '',
    ts: now,
  }

  // Use fetch with keepalive so the request survives page navigation
  // (Beacon API would be nicer but does not support custom JSON
  // content-type cleanly).
  fetch(SEND_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Reporter cannot recursively report a reporter failure; swallow.
  })
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    return String(v)
  }
}
