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
  //   repo  — read/write vault repo content (the original capability)
  //   gist  — create gists from the "Publish as gist" surface
  // Existing tokens issued with `repo` only still work for sync, but
  // the gist endpoint returns 404/401 for them; PublishGistModal
  // surfaces a "re-authorise" message via GistScopeError when that
  // happens, so the upgrade path is gentle (no forced re-auth at startup).
  const upstream = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo gist' }),
  })

  const data = await upstream.json().catch(() => ({}))
  return NextResponse.json(data, { status: upstream.status })
}
