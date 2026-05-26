import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/utils/rateLimit'
import { isOriginAllowed } from '@/utils/originAllowlist'

// Browser → this route → github.com (CORS proxy for the OAuth refresh-token
// grant). Stateless: like /access-token we never store tokens, we just forward
// the exchange and return GitHub's JSON.
//
// A GitHub App that issues EXPIRING user access tokens (~8h) also issues a
// refresh_token (~6 months). When the access token nears expiry — or a call
// 401s — the client POSTs the refresh_token here and we exchange it for a fresh
// token set. GitHub ROTATES the refresh_token on every use, so the response
// carries a NEW refresh_token the client must persist.
//
// Mirrors the access-token route's guards: same-origin allow-list (this route
// returns live tokens in the body, so a malicious origin that pocketed a user's
// refresh_token must not be able to launder a renewal through us) + per-IP rate
// limit + client_id from env.
export async function POST(request: Request) {
  const origin = isOriginAllowed(request)
  if (!origin.ok) {
    return NextResponse.json(
      { error: 'forbidden', error_description: origin.reason },
      { status: 403 },
    )
  }
  // A refresh is a once-per-~8h event per user under normal use; allow a modest
  // burst (retries, multiple tabs) but keep it bounded. 10 per minute matches
  // the device-code route's allowance.
  const limit = checkRateLimit(`refresh:${getClientIp(request)}`, { max: 10, windowMs: 60_000 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', error_description: 'Too many refresh attempts. Please wait.' },
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

  let body: { refresh_token?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Body must be JSON' }, { status: 400 })
  }
  const refreshToken = body.refresh_token
  if (!refreshToken) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'refresh_token required' }, { status: 400 })
  }

  const upstream = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  const data = await upstream.json().catch(() => ({}))
  return NextResponse.json(data, { status: upstream.status })
}
