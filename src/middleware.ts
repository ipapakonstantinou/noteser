import { NextResponse, type NextRequest } from 'next/server'

import { buildCsp, deriveCollabWsOrigin, deriveGitHostOrigin } from '@/utils/csp'

/**
 * Per-request nonce-based CSP (Finding 6 of the 2026-05-21 security audit).
 *
 * The CSP used to be a static header in next.config.mjs with
 * `script-src 'self' 'unsafe-inline'`, which let any injected inline <script>
 * run. Here we mint a fresh nonce per request, build the policy with that
 * nonce + 'strict-dynamic' (no 'unsafe-inline' for scripts), forward the
 * nonce to the App Router via the `x-nonce` request header (read in
 * src/app/layout.tsx so Next's own bootstrap scripts get the nonce), and set
 * the CSP on the response.
 *
 * The CSP-building logic itself lives in src/utils/csp.ts so it can be
 * unit-tested without a running server.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const csp = buildCsp(nonce, {
    isDev: process.env.NODE_ENV !== 'production',
    wsOrigin: deriveCollabWsOrigin(process.env.NEXT_PUBLIC_YJS_WS_URL),
    gitHostOrigin: deriveGitHostOrigin(process.env.NEXT_PUBLIC_FORGEJO_BASE_URL),
    // /share renders arbitrary shared content to arbitrary visitors — no
    // remote-image tracking pixels there. See BuildCspOptions.restrictImages.
    restrictImages: request.nextUrl.pathname.startsWith('/share'),
  })

  // Forward the nonce to the request so server components (layout.tsx) can
  // read it and hand it to Next's bootstrap scripts.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  // Run on every request except Next's static assets / image optimizer /
  // favicon, which don't need a CSP and would just add overhead.
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
}
