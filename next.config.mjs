/** @type {import('next').NextConfig} */

// Security headers applied to every response. CSP is permissive enough to
// keep the app working (CodeMirror + react-syntax-highlighter use inline
// styles, Tailwind injects style tags, GitHub avatars come from a few
// different githubusercontent CDNs) while still cutting common XSS vectors.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // unsafe-inline + unsafe-eval are required by Next.js dev mode and the
      // CodeMirror runtime. We keep them in production too because Next emits
      // some bootstrap scripts inline.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // GitHub avatars + GitHub-served images
      "img-src 'self' data: blob: https://avatars.githubusercontent.com https://*.githubusercontent.com",
      "font-src 'self' data:",
      // /api/github/* proxies + direct api.github.com calls from the browser.
      // Plus optional self-hosted Yjs server (wss/ws).
      "connect-src 'self' https://api.github.com https://github.com wss: ws:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
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

export default nextConfig
