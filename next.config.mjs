/** @type {import('next').NextConfig} */

// Derive a single WS origin from NEXT_PUBLIC_YJS_WS_URL so CSP only allows
// the collaboration server the operator opted into. Anything malformed (or
// unset) collapses to "no WS connections at all" — the old `wss: ws:` bare
// wildcards would let an XSS payload exfiltrate localStorage to any host.
function deriveCollabWsOrigin(raw) {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

const collabWsOrigin = deriveCollabWsOrigin(process.env.NEXT_PUBLIC_YJS_WS_URL)

const connectSrc = [
  "'self'",
  'https://api.github.com',
  'https://github.com',
  'https://api.anthropic.com',
  'https://api.openai.com',
  ...(collabWsOrigin ? [collabWsOrigin] : []),
].join(' ')

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
      // The optional Yjs collab server is added only when
      // NEXT_PUBLIC_YJS_WS_URL is a valid ws:// or wss:// URL.
      `connect-src ${connectSrc}`,
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

// Exported for tests so the CSP string can be exercised without spinning up
// a Next server. Not part of the Next runtime contract.
export { deriveCollabWsOrigin, securityHeaders }
export default nextConfig
