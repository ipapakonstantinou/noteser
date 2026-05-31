/** @type {import('next').NextConfig} */

// Security headers applied to every response.
//
// NOTE: the Content-Security-Policy is intentionally NOT here. As of the
// 2026-05-21 audit (Finding 6) the CSP is built PER REQUEST with a fresh
// nonce in `src/middleware.ts` (logic in `src/utils/csp.ts`), so it can drop
// `'unsafe-inline'` from script-src. Setting a *second* static CSP here would
// be a mistake: browsers INTERSECT multiple CSP headers, which can silently
// over-tighten the policy and break the nonce-based one. Keep CSP in exactly
// one place — the middleware.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  // HSTS — 2 years + includeSubDomains. Vercel already sets a bare
  // max-age=63072000 by platform default; setting our own here adds the
  // includeSubDomains directive (every noteser.app subdomain must serve
  // HTTPS, which they do). The `preload` directive is intentionally OFF:
  // enrolling at hstspreload.org is a one-way commitment, hard to reverse,
  // and offers little practical gain for an existing site over plain HSTS
  // with includeSubDomains.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
]

// Per-build identifier exposed to the client. The service worker is
// registered as `/sw.js?v=<BUILD_ID>` so that the registration URL changes
// on every deploy — that is what makes the browser detect a new SW and
// install it (the committed sw.js bytes never change). On Vercel we use the
// commit SHA; locally / on any other host we fall back to a build timestamp.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())

const nextConfig = {
  // Suppress the `X-Powered-By: Next.js` response header. Pure
  // fingerprint suppression — no security benefit beyond making the
  // stack harder to identify in passive scans. Vercel still emits
  // `Server: Vercel`, which we cannot strip from the platform.
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

// Exported for tests. Not part of the Next runtime contract.
export { securityHeaders }
export default nextConfig
