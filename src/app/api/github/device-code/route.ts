import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/utils/rateLimit'
import { isOriginAllowed } from '@/utils/originAllowlist'

// Browser → this route → github.com (CORS proxy for OAuth device-code endpoint).
// Stateless: we never touch tokens; this just forwards the request.
//
// Rate-limited per-IP so the proxy can't be abused as a load-amplifier
// against our GitHub OAuth App (it shares a quota with the user's normal
// device-flow usage).
export async function POST(request: Request) {
  // Same-origin guard: refuse calls that didn't originate from the
  // noteser app itself. Prevents a malicious page from laundering an
  // OAuth device flow through our proxy.
  const origin = isOriginAllowed(request)
  if (!origin.ok) {
    return NextResponse.json(
      { error: 'forbidden', error_description: origin.reason },
      { status: 403 },
    )
  }
  const limit = checkRateLimit(`device:${getClientIp(request)}`, { max: 10, windowMs: 60_000 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', error_description: 'Too many requests. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(limit.retryAfterMs / 1000).toString() } },
    )
  }

  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'missing_client_id', error_description: 'NEXT_PUBLIC_GITHUB_CLIENT_ID is not set' },
      { status: 500 },
    )
  }

  // Scopes:
  //   repo  — read/write vault repo content (the original capability,
  //           granted to every user at sign-in).
  //   gist  — create gists from the "Publish as gist" surface. Requested
  //           on demand only — the FIRST time a user tries to publish a
  //           gist, PublishGistModal kicks off a second device flow that
  //           sends `{ scope: 'repo gist' }` here so GitHub re-issues a
  //           wider token. Users who never publish a gist are never asked
  //           for the gist scope, which keeps the localStorage-token XSS
  //           blast radius minimal (see security-audit Finding 2).
  //
  // Allow-list of scope strings we will forward. Anything else (or no
  // body at all) falls back to the safe default `repo`. This stops a
  // malicious page from coaxing the proxy into asking GitHub for
  // arbitrary scopes (`admin:org`, `delete_repo`, …) on the user's
  // behalf — even though the same-origin guard above already blocks
  // cross-origin callers, defence in depth is cheap here.
  const ALLOWED_SCOPES = new Set(['repo', 'repo gist'])
  let requestedScope = 'repo'
  try {
    // Body is optional — old callers (`startDeviceFlow()` with no arg)
    // send no body, so JSON.parse on empty string would throw.
    const text = await request.text()
    if (text) {
      const body = JSON.parse(text) as { scope?: unknown }
      if (typeof body.scope === 'string' && ALLOWED_SCOPES.has(body.scope)) {
        requestedScope = body.scope
      }
    }
  } catch {
    // Malformed JSON → fall through with the default `repo` scope.
  }

  const upstream = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: requestedScope }),
  })

  const data = await upstream.json().catch(() => ({}))
  return NextResponse.json(data, { status: upstream.status })
}
