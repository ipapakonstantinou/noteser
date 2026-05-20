import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/utils/rateLimit'
import { isOriginAllowed } from '@/utils/originAllowlist'

// Browser polls this while the user authorizes in github.com.
// On success the upstream responds with { access_token, token_type, scope };
// while pending it responds with { error: 'authorization_pending' | 'slow_down' | ... }.
//
// Rate-limited per-IP at a higher allowance than /device-code because this
// route gets POLLED — every ~5s by spec — during a normal device-flow login.
// Allow ~10 hits per 5-second window.
export async function POST(request: Request) {
  // Same-origin guard — far more important here than on device-code
  // because this route returns the actual OAuth token in the response
  // body. A malicious site that polled with someone else's device_code
  // would otherwise pocket their token.
  const origin = isOriginAllowed(request)
  if (!origin.ok) {
    return NextResponse.json(
      { error: 'forbidden', error_description: origin.reason },
      { status: 403 },
    )
  }
  const limit = checkRateLimit(`token:${getClientIp(request)}`, { max: 10, windowMs: 5_000 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', error_description: 'Polling too fast. Please wait.' },
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

  let body: { device_code?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Body must be JSON' }, { status: 400 })
  }
  const deviceCode = body.device_code
  if (!deviceCode) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'device_code required' }, { status: 400 })
  }

  const upstream = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })

  const data = await upstream.json().catch(() => ({}))
  return NextResponse.json(data, { status: upstream.status })
}
