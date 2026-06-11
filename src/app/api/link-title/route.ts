import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/utils/rateLimit'
import { isOriginAllowed } from '@/utils/originAllowlist'
import { extractHtmlTitle } from '@/utils/pasteLink'

// Page-title lookup for the paste-URL-as-titled-link feature. The browser
// cannot fetch arbitrary pages itself (CORS), so this thin proxy GETs the
// URL server-side and returns the extracted <title> / og:title.
//
// Limits applied at this layer:
//   - Same-origin requests only (this is not an open title-scraping API)
//   - Per-IP rate limit: 30/min — pasting links is a human-speed action
//   - http(s) targets only, public hosts only (no localhost / RFC1918 /
//     link-local / dotless intranet names) to keep SSRF surface closed
//   - 5s fetch timeout, response body read capped at 256 KB
//
// Auth-walled pages (e.g. a private Jira) return their login page's title
// or fail entirely — the client falls back to pasting the bare URL.

const FETCH_TIMEOUT_MS = 5_000
const MAX_BODY_BYTES = 256 * 1024
const MAX_URL_CHARS = 2_048

export async function GET(request: Request) {
  const origin = isOriginAllowed(request)
  if (!origin.ok) {
    return NextResponse.json({ error: 'forbidden', message: origin.reason }, { status: 403 })
  }

  const limit = checkRateLimit(`link-title:${getClientIp(request)}`, { max: 30, windowMs: 60_000 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': Math.ceil(limit.retryAfterMs / 1000).toString() } },
    )
  }

  const target = new URL(request.url).searchParams.get('url') ?? ''
  const validated = validateTargetUrl(target)
  if (!validated.ok) {
    return NextResponse.json({ error: 'invalid_url', message: validated.reason }, { status: 400 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(validated.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some sites refuse requests without a UA; identify honestly.
        'User-Agent': 'noteser-link-title/1.0 (+https://noteser.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !/text\/html|application\/xhtml/i.test(contentType)) {
      return NextResponse.json({ title: null })
    }

    const html = await readCapped(res, MAX_BODY_BYTES)
    const title = extractHtmlTitle(html)
    return NextResponse.json(
      { title },
      // Titles are stable; let the CDN absorb repeat pastes of hot links.
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } },
    )
  } catch {
    // Timeout, DNS failure, TLS error — all map to "no title available".
    return NextResponse.json({ title: null })
  } finally {
    clearTimeout(timer)
  }
}

function validateTargetUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  if (!raw || raw.length > MAX_URL_CHARS) return { ok: false, reason: 'missing or oversized url' }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'malformed url' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http(s) urls are supported' }
  }
  if (!isPublicHost(url.hostname)) {
    return { ok: false, reason: 'host not allowed' }
  }
  return { ok: true, url }
}

// SSRF guard: refuse loopback, RFC1918/link-local literals, IPv6
// literals, and dotless intranet names. DNS names that *resolve* to
// private space are not caught here (full protection needs resolver
// hooks), but on Vercel's serverless network there is no private LAN
// to reach anyway — this guard is defense in depth.
function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false
  if (!host.includes('.')) return false // dotless = intranet name
  if (host.includes(':') || host.startsWith('[')) return false // IPv6 literal
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 127 || a === 10 || a === 0) return false
    if (a === 169 && b === 254) return false
    if (a === 192 && b === 168) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a >= 224) return false // multicast/reserved
  }
  return true
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let html = ''
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    html += decoder.decode(value, { stream: true })
    // The <title>/og:title live in <head>; stop early once we have it
    // or once the cap is hit — no need to download a whole page.
    if (received >= maxBytes || /<\/head>/i.test(html)) {
      void reader.cancel().catch(() => {})
      break
    }
  }
  return html
}
