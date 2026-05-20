/** @type {import('next').NextConfig} */

// Security headers applied to every response. CSP is permissive enough to
// keep the app working (CodeMirror + react-syntax-highlighter use inline
// styles, Tailwind injects style tags, BYO AI APIs hit Anthropic / OpenAI
// directly from the browser) while still cutting common XSS vectors.
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
      // User notes can ![]() any HTTPS image. data:/blob: for attachments.
      // We leave img-src open to https: rather than maintain an allowlist of
      // hosts the user might paste in.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Browser-direct API surfaces: github.com for OAuth fallbacks, the
      // GitHub Git Data API, Anthropic + OpenAI for BYO-key AI features.
      // wss/ws for the optional self-hosted Yjs server.
      "connect-src 'self' https://api.github.com https://github.com https://api.anthropic.com https://api.openai.com wss: ws:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
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
