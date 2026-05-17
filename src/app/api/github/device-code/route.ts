import { NextResponse } from 'next/server'

// Browser → this route → github.com (CORS proxy for OAuth device-code endpoint).
// Stateless: we never touch tokens; this just forwards the request.
export async function POST() {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'missing_client_id', error_description: 'NEXT_PUBLIC_GITHUB_CLIENT_ID is not set' },
      { status: 500 },
    )
  }

  const upstream = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
  })

  const data = await upstream.json().catch(() => ({}))
  return NextResponse.json(data, { status: upstream.status })
}
