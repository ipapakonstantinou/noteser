import { NextResponse } from 'next/server'

// Browser polls this while the user authorizes in github.com.
// On success the upstream responds with { access_token, token_type, scope };
// while pending it responds with { error: 'authorization_pending' | 'slow_down' | ... }.
export async function POST(request: Request) {
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
