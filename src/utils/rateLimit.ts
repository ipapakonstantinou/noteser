// In-memory per-IP rate limiter for the /api/github/* proxy routes.
// Survives the lifetime of one Node process — that's enough for a single
// Vercel serverless instance under normal traffic; it'll reset when the
// instance recycles. For a real production-grade limiter use Upstash Redis
// or Vercel KV instead.

interface Bucket {
  // Timestamps (ms epoch) of requests in the current window. Old ones are
  // shifted out lazily on each check.
  hits: number[]
}

const BUCKETS = new Map<string, Bucket>()

export interface RateLimitOptions {
  // Max requests allowed per window.
  max: number
  // Window length in milliseconds.
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  // Milliseconds until the user can try again (always present; 0 when ok).
  retryAfterMs: number
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const cutoff = now - opts.windowMs
  let bucket = BUCKETS.get(key)
  if (!bucket) {
    bucket = { hits: [] }
    BUCKETS.set(key, bucket)
  }
  // Drop expired hits.
  while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) bucket.hits.shift()

  if (bucket.hits.length >= opts.max) {
    const oldest = bucket.hits[0]
    return { ok: false, remaining: 0, retryAfterMs: opts.windowMs - (now - oldest) }
  }
  bucket.hits.push(now)
  return { ok: true, remaining: opts.max - bucket.hits.length, retryAfterMs: 0 }
}

// Extract the client IP from incoming-request headers.
//
// x-forwarded-for is comma-separated with the FORMAT
//   <client>, <proxy-1>, <proxy-2>, …
// On Vercel, the platform writes XFF authoritatively — the leftmost
// value IS the real client IP. But on self-hosted deployments behind
// a reverse proxy that DOESN'T strip incoming XFFs (nginx without
// `set_real_ip_from`, plain Caddy, etc.), an attacker can send
//   X-Forwarded-For: 1.2.3.4
// and rotate to a fresh rate-limit bucket on every request — Audit
// finding 4 (medium severity).
//
// The fix: TRUSTED_PROXY_COUNT env var tells us how many right-hand
// XFF entries were added by trusted proxies in front of us. We strip
// THAT many from the right of the list, then take the rightmost of
// what remains (which is the IP the closest-trusted proxy saw). With
// the default value of 1 (Vercel's behaviour), the leftmost is still
// chosen, matching prior behaviour.
//
// Examples:
//   XFF = "evil, real-client, vercel-edge"   TRUSTED_PROXY_COUNT=1
//     → strip 1 from right → "evil, real-client"
//     → take rightmost     → "real-client"   ← can't be spoofed
//
//   XFF = "real-client, vercel-edge"          TRUSTED_PROXY_COUNT=1
//     → strip 1 from right → "real-client"
//     → take rightmost     → "real-client"   ← same as before
//
// Setting TRUSTED_PROXY_COUNT=0 in environments with NO trusted proxy
// (rare for browser apps) means: trust no value from XFF, fall back
// to x-real-ip and then the unknown sentinel. Self-hosters behind
// multiple proxies should bump the count.
export function getClientIp(req: Request): string {
  const trustedCountRaw = process.env.TRUSTED_PROXY_COUNT
  // Defaults to 1 — matches Vercel's "edge wrote the rightmost entry"
  // contract, which has been the implicit assumption all along.
  const parsed = trustedCountRaw != null ? parseInt(trustedCountRaw, 10) : NaN
  const trustedCount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1

  // count=0 means "no trusted proxies" — XFF is fully attacker-controlled
  // and we should skip it entirely.
  if (trustedCount > 0) {
    const xff = req.headers.get('x-forwarded-for')
    if (xff) {
      const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
      // Strip `trustedCount` entries from the right. After trimming,
      // the rightmost survivor is the IP the closest trusted proxy
      // saw. If the trim emptied the list (XFF didn't include any
      // proxy-added entries), fall through to x-real-ip.
      if (parts.length > trustedCount) {
        return parts[parts.length - 1 - trustedCount]
      }
    }
  }
  const xrip = req.headers.get('x-real-ip')
  if (xrip) return xrip.trim()
  return '__unknown__'
}
