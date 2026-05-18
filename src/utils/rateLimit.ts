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

// Extract the client IP from incoming-request headers. Vercel sets
// x-forwarded-for (comma-separated, leftmost is the original client). Fall
// back to x-real-ip, then a constant so we still get *some* throttling.
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xrip = req.headers.get('x-real-ip')
  if (xrip) return xrip.trim()
  return '__unknown__'
}
