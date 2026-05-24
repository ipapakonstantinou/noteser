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
]

const nextConfig = {
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
