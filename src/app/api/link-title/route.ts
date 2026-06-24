import { lookup } from 'node:dns/promises'
import type { LookupFunction } from 'node:net'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import type { Response as UndiciResponse } from 'undici'
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
//   - the hostname is resolved via DNS and the request is refused unless
//     EVERY resolved address is public — this closes the DNS-rebinding /
//     cloud-metadata (169.254.169.254) hole where a public-looking name
//     points at internal space
//   - the connection is pinned to the exact address(es) that were just
//     validated (via a custom dispatcher lookup), so the TCP connect
//     can't race a second, independent DNS resolution that answers
//     differently than the one we checked
//   - redirects are NOT auto-followed by the HTTP client: each hop's
//     Location is re-validated and re-pinned from scratch, so a public
//     URL can't bounce the request into internal space via a 3xx
//   - 5s fetch timeout (shared across all hops), response body read
//     capped at 256 KB
//
// Auth-walled pages (e.g. a private Jira) return their login page's title
// or fail entirely — the client falls back to pasting the bare URL.

const FETCH_TIMEOUT_MS = 5_000
const MAX_BODY_BYTES = 256 * 1024
const MAX_URL_CHARS = 2_048
const MAX_REDIRECTS = 5

type ValidatedTarget = { url: URL; addresses: { address: string; family: number }[] }

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
  let validated = await validateTargetUrl(target)
  if (!validated.ok) {
    return NextResponse.json({ error: 'invalid_url', message: validated.reason }, { status: 400 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    for (let hop = 0; ; hop++) {
      const agent = new Agent({ connect: { lookup: pinnedLookup(validated.value.addresses) } })
      let res: UndiciResponse
      try {
        res = await undiciFetch(validated.value.url, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            // Some sites refuse requests without a UA; identify honestly.
            'User-Agent': 'noteser-link-title/1.0 (+https://noteser.app)',
            Accept: 'text/html,application/xhtml+xml',
          },
          dispatcher: agent,
        })
      } finally {
        void agent.close().catch(() => {})
      }

      if (isRedirectStatus(res.status)) {
        if (hop >= MAX_REDIRECTS) return NextResponse.json({ title: null })
        const location = res.headers.get('location')
        if (!location) return NextResponse.json({ title: null })
        let nextRaw: string
        try {
          nextRaw = new URL(location, validated.value.url).toString()
        } catch {
          return NextResponse.json({ title: null })
        }
        const nextValidated = await validateTargetUrl(nextRaw)
        if (!nextValidated.ok) return NextResponse.json({ title: null })
        validated = nextValidated
        continue
      }

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
    }
  } catch {
    // Timeout, DNS failure, TLS error — all map to "no title available".
    return NextResponse.json({ title: null })
  } finally {
    clearTimeout(timer)
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

// Builds a dns.lookup-compatible function that ignores whatever hostname
// it's asked about and always answers with the addresses that were
// already validated for this hop. This is what lets the HTTP client
// connect to the exact IP we checked instead of re-resolving DNS (and
// possibly getting a different, unchecked answer) at connect time.
function pinnedLookup(addresses: { address: string; family: number }[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options && typeof options === 'object' && options.all) {
      callback(null, addresses)
      return
    }
    const wantFamily = typeof options === 'object' ? options?.family : undefined
    const match = (wantFamily ? addresses.find((a) => a.family === wantFamily) : undefined) ?? addresses[0]
    callback(null, match.address, match.family)
  }
}

async function validateTargetUrl(
  raw: string,
): Promise<{ ok: true; value: ValidatedTarget } | { ok: false; reason: string }> {
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
  if (!isPublicHostname(url.hostname)) {
    return { ok: false, reason: 'host not allowed' }
  }

  // Resolve the name and refuse unless every resolved address is public.
  // Without this, a public-looking host can point at 127.0.0.1, RFC1918
  // space, or the 169.254.169.254 cloud-metadata endpoint (SSRF). We
  // gate on the resolved IPs the OS will actually connect to, and the
  // caller pins the connection to exactly these addresses (see
  // `pinnedLookup`) so a later, independent lookup can't disagree.
  const literal = isIP(url.hostname)
  if (literal) {
    // hostname is an IP literal: validate it directly (strip IPv6 brackets).
    const address = stripBrackets(url.hostname)
    if (!isPublicAddress(address)) {
      return { ok: false, reason: 'host not allowed' }
    }
    return { ok: true, value: { url, addresses: [{ address, family: literal }] } }
  }
  let addresses: { address: string; family: number }[]
  try {
    addresses = await lookup(url.hostname, { all: true })
  } catch {
    return { ok: false, reason: 'host could not be resolved' }
  }
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
    return { ok: false, reason: 'host resolves to a non-public address' }
  }
  return { ok: true, value: { url, addresses } }
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

// Cheap name-based pre-filter (before any DNS): refuse loopback names,
// link-local / intranet suffixes, and dotless intranet names.
function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (isIP(stripBrackets(host))) return true // IP literals handled by isPublicAddress
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false
  if (!host.includes('.')) return false // dotless = intranet name
  return true
}

// True only for globally-routable unicast addresses. Rejects loopback,
// RFC1918, link-local (incl. 169.254.169.254 cloud metadata), CGNAT,
// multicast/reserved, and their IPv6 equivalents (::1, fc00::/7, fe80::/10,
// IPv4-mapped/-compatible v6).
function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return isPublicIPv4(ip)
  if (kind === 6) return isPublicIPv6(ip)
  return false
}

function isPublicIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false
  if (a === 0 || a === 127 || a === 10) return false // this-network, loopback, RFC1918
  if (a === 169 && b === 254) return false // link-local + cloud metadata
  if (a === 192 && b === 168) return false // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return false // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT 100.64.0.0/10
  if (a >= 224) return false // multicast / reserved / broadcast
  return true
}

function isPublicIPv6(ip: string): boolean {
  const host = ip.toLowerCase()
  if (host === '::' || host === '::1') return false // unspecified, loopback
  if (host.startsWith('fe80')) return false // link-local fe80::/10
  if (host.startsWith('fc') || host.startsWith('fd')) return false // unique-local fc00::/7
  if (host.startsWith('ff')) return false // multicast
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): validate
  // the embedded IPv4 so a private v4 cannot be smuggled through v6.
  const embedded = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (embedded) return isPublicIPv4(embedded[1])
  return true
}

async function readCapped(res: UndiciResponse, maxBytes: number): Promise<string> {
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
