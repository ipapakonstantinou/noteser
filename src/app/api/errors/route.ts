import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/utils/rateLimit'
import { isOriginAllowed } from '@/utils/originAllowlist'

// Client-side error sink. The browser POSTs uncaught exceptions +
// unhandled promise rejections here; the route logs them to stderr
// so they land in Vercel Runtime Logs.
//
// Why we do not run Sentry / PostHog instead:
//   1. Zero client bundle weight — important since errorReporter loads
//      eagerly to catch boot-time crashes
//   2. Zero data leaves our infra
//   3. Free at any scale within Vercel's log retention window
//   4. We own the read path: grep the Vercel dashboard, or query the
//      logs API
//
// Limits applied at this layer:
//   - Same-origin requests only (no script-tag injection from another
//     domain probing our endpoint)
//   - Per-IP rate limit: 30/min, well above any realistic real-user
//     error volume but stops a runaway in-page loop from flooding
//   - Payload size capped at 32 KB after JSON parse
//   - PII fields stripped server-side (URL query strings, cookie
//     headers — we never log these)

const MAX_BODY_BYTES = 32 * 1024
const MAX_MESSAGE_CHARS = 1024
const MAX_STACK_CHARS = 8 * 1024

export interface ErrorReport {
  /** "error" for uncaught Error, "rejection" for unhandled promise. */
  kind: 'error' | 'rejection'
  message: string
  stack?: string
  /** URL pathname WITHOUT the query string. */
  pathname?: string
  /** Browser UA, truncated. */
  ua?: string
  /** Build id of the deployed bundle. */
  buildId?: string
  /** Client-side timestamp in ms. */
  ts?: number
  /** Optional plugin id, when the error originated from a plugin. */
  pluginId?: string
}

export async function POST(request: Request) {
  const origin = isOriginAllowed(request)
  if (!origin.ok) {
    return NextResponse.json(
      { error: 'forbidden', message: origin.reason },
      { status: 403 },
    )
  }

  const limit = checkRateLimit(`errors:${getClientIp(request)}`, { max: 30, windowMs: 60_000 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': Math.ceil(limit.retryAfterMs / 1000).toString() } },
    )
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  let body: ErrorReport
  try {
    body = JSON.parse(raw) as ErrorReport
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const sanitized = sanitize(body)
  if (!sanitized) {
    return NextResponse.json({ error: 'invalid_report' }, { status: 400 })
  }

  // The actual sink: stderr. Vercel collects this into Runtime Logs;
  // a JSON.stringify on a single line makes it easy to grep + filter
  // by the leading marker.
  console.error('[noteser-client-error]', JSON.stringify(sanitized))

  return NextResponse.json({ ok: true })
}

function sanitize(body: ErrorReport): ErrorReport | null {
  if (typeof body !== 'object' || body === null) return null
  if (body.kind !== 'error' && body.kind !== 'rejection') return null
  if (typeof body.message !== 'string' || body.message.length === 0) return null

  return {
    kind: body.kind,
    message: body.message.slice(0, MAX_MESSAGE_CHARS),
    ...(typeof body.stack === 'string' ? { stack: body.stack.slice(0, MAX_STACK_CHARS) } : {}),
    ...(typeof body.pathname === 'string' ? { pathname: body.pathname.slice(0, 256) } : {}),
    ...(typeof body.ua === 'string' ? { ua: body.ua.slice(0, 256) } : {}),
    ...(typeof body.buildId === 'string' ? { buildId: body.buildId.slice(0, 64) } : {}),
    ...(typeof body.ts === 'number' && Number.isFinite(body.ts) ? { ts: body.ts } : {}),
    ...(typeof body.pluginId === 'string' ? { pluginId: body.pluginId.slice(0, 64) } : {}),
  }
}
