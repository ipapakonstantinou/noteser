// Origin / Referer allowlist for the GitHub OAuth proxy routes
// (`/api/github/device-code`, `/api/github/access-token`).
//
// Background: today both routes accept POSTs from any origin. The
// rate-limit (per-IP) caps brute-force load, but it doesn't stop a
// malicious page from initiating an OAuth device flow with the user's
// IP — if the user happened to approve the code on github.com, the
// other origin could poll our `/access-token` route and steal the
// resulting token.
//
// Same-origin check + a small env-driven allowlist (Vercel preview
// deploys, local dev) closes that hole without breaking the legitimate
// flow.

const VERCEL_PREVIEW_HOST_SUFFIX = '.vercel.app'

/**
 * Return true when the request's Origin/Referer header is one of the
 * origins we trust. We accept:
 *   - same-origin (matches the request URL's protocol + host)
 *   - `http://localhost:*`        (any port, for `next dev`)
 *   - `http://127.0.0.1:*`        (same idea over loopback)
 *   - `http://<lan-ip>:*`         (Linux dev binding to 0.0.0.0)
 *   - `https://*.vercel.app`      (preview deploys)
 *   - anything in NEXT_PUBLIC_EXTRA_ORIGINS (comma-sep list)
 *
 * Returns the resolved origin used for the decision so callers can log
 * it; null when no allowed origin is present.
 */
export function isOriginAllowed(request: Request): { ok: true; origin: string } | { ok: false; reason: string } {
  const url = new URL(request.url)
  const headerOrigin = request.headers.get('origin') || ''
  const headerReferer = request.headers.get('referer') || ''

  // Prefer Origin; fall back to Referer's origin slice. Plain server-to-
  // server callers send neither, which is a refuse — these routes are
  // only meant to be hit from the noteser browser app.
  const claim = headerOrigin || (headerReferer ? safeOrigin(headerReferer) : '')
  if (!claim) return { ok: false, reason: 'missing Origin/Referer header' }

  // Same-origin always passes.
  if (claim === `${url.protocol}//${url.host}`) return { ok: true, origin: claim }

  // localhost / loopback / private LAN — covers `next dev` on any port,
  // including binding 0.0.0.0 for second-device testing.
  try {
    const c = new URL(claim)
    if (c.hostname === 'localhost' || c.hostname === '127.0.0.1') return { ok: true, origin: claim }
    if (isPrivateLanHost(c.hostname)) return { ok: true, origin: claim }
    if (c.protocol === 'https:' && c.hostname.endsWith(VERCEL_PREVIEW_HOST_SUFFIX)) {
      return { ok: true, origin: claim }
    }
  } catch {
    return { ok: false, reason: 'malformed Origin/Referer' }
  }

  // Optional env-driven extras (comma-separated full origins).
  const extras = (process.env.NEXT_PUBLIC_EXTRA_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (extras.includes(claim)) return { ok: true, origin: claim }

  return { ok: false, reason: `origin not allowed: ${claim}` }
}

// 10.x.x.x, 172.16.x.x — 172.31.x.x, 192.168.x.x are RFC1918 private
// ranges. Anyone reaching us at a private IP is on the same LAN as the
// dev box, which we trust for development. Public IPs / DNS names go
// through the same-origin or extras path instead.
function isPrivateLanHost(host: string): boolean {
  if (host === '0.0.0.0') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1]); const b = Number(m[2])
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function safeOrigin(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}
