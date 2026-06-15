import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/utils/rateLimit'
import { isOriginAllowed } from '@/utils/originAllowlist'

// Server-side proxy for the launch-update mailing list. The browser POSTs
// an email here; this route forwards it to Buttondown using
// BUTTONDOWN_API_KEY (server-only env var — never reaches the client).
//
// Same-origin guard + per-IP rate limit so an attacker can't pump spam
// signups through this endpoint. 5 attempts per minute per IP is enough
// for legitimate typo-correction without enabling abuse.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  const origin = isOriginAllowed(request)
  if (!origin.ok) {
    return NextResponse.json(
      { error: 'forbidden', message: origin.reason },
      { status: 403 },
    )
  }

  const limit = checkRateLimit(`subscribe:${getClientIp(request)}`, { max: 5, windowMs: 60_000 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many attempts. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(limit.retryAfterMs / 1000).toString() } },
    )
  }

  const key = process.env.BUTTONDOWN_API_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'misconfigured', message: 'Subscription is temporarily unavailable.' },
      { status: 500 },
    )
  }

  let body: { email?: string; source?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request', message: 'Body must be JSON.' }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid_email', message: 'That does not look like a valid email address.' }, { status: 400 })
  }

  // Tag the signup so we can later see "marketing landing" vs "settings panel"
  // attribution in Buttondown. Default to site-landing if the caller omits.
  const source = typeof body.source === 'string' && body.source.length < 64 ? body.source : 'site-landing'

  const upstream = await fetch('https://api.buttondown.com/v1/subscribers', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${key}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ email_address: email, tags: [source] }),
  })

  // 201 = created, 200 = updated (Buttondown may return either).
  if (upstream.status === 200 || upstream.status === 201) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Already-subscribed → still a success from the user's perspective.
  // Buttondown returns 400 with a code field for duplicates.
  const data = await upstream.json().catch(() => null) as { code?: string; detail?: string } | null
  if (upstream.status === 400 && data?.code === 'email_already_exists') {
    return NextResponse.json({ ok: true, alreadySubscribed: true }, { status: 200 })
  }

  // Anything else: do not leak Buttondown's internals to the browser; just
  // surface a generic error message.
  return NextResponse.json(
    { error: 'upstream_error', message: 'Could not subscribe right now. Please try again later.' },
    { status: 502 },
  )
}
