import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/utils/rateLimit'
import { isOriginAllowed } from '@/utils/originAllowlist'

// Smart HTTP CORS proxy for isomorphic-git pushes.
//
// GitHub's git endpoints (`https://github.com/<owner>/<repo>.git/info/refs`,
// `https://github.com/<owner>/<repo>.git/git-upload-pack`, etc.) don't
// return CORS headers, so a browser can't speak git directly to them.
// Same shape as the `cors.isomorphic-git.org` public proxy — but
// hosted on our own infra so we control the trust + lifetime.
//
// The path under `/api/git-proxy/...` is forwarded to
// `https://<rest>`. So `GET /api/git-proxy/github.com/foo/bar.git/info/refs?service=git-upload-pack`
// hits `https://github.com/foo/bar.git/info/refs?service=git-upload-pack`.
//
// Methods forwarded verbatim: GET (capability discovery), POST
// (push + fetch pack-files). Body, query-string, and the relevant
// headers (Authorization, User-Agent, Content-Type, Accept) are
// passed through.
//
// Guarded by the same two checks every other proxy route here runs —
// origin allowlist (so it can't be turned into an open anonymising CORS
// proxy from any web page) and a per-IP rate limit (so it can't be
// turned into bandwidth amplification). One git push fans out into a
// handful of round-trips, so the bucket is more generous than the OAuth
// routes; a comfortable upper bound that still trips on serious abuse.

// We only forward to a tight allow-list of hosts so the proxy can't
// be turned into an open relay. Add hosts here if a user reports
// needing them (GitLab, Bitbucket, self-hosted Gitea, etc.).
const ALLOWED_HOSTS = new Set([
  'github.com',
])

const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'user-agent',
  'git-protocol',
]

const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'content-encoding',
]

// Single handler used for both GET and POST — the only difference is
// whether we forward a body.
async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  // Same-origin guard: refuse calls that didn't originate from the
  // noteser app itself. Without this the route is an open CORS+anon
  // proxy to GitHub for anyone on the internet.
  const origin = isOriginAllowed(req)
  if (!origin.ok) {
    return NextResponse.json(
      { error: 'forbidden', message: origin.reason },
      { status: 403 },
    )
  }
  // Per-IP rate limit. One sync = a few round-trips, so we allow a
  // comfortable headroom for active editing/auto-sync. The cap trips
  // bandwidth-amplification abuse without affecting normal users.
  const limit = checkRateLimit(`git-proxy:${getClientIp(req)}`, { max: 120, windowMs: 60_000 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many git-proxy requests. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(limit.retryAfterMs / 1000).toString() } },
    )
  }

  const resolved = await params
  const segments = resolved.path ?? []
  if (segments.length < 2) {
    return NextResponse.json({ error: 'bad_request', message: 'Missing host + path' }, { status: 400 })
  }
  const [host, ...rest] = segments
  if (!ALLOWED_HOSTS.has(host)) {
    return NextResponse.json({ error: 'forbidden_host', message: `Host ${host} not in allow-list` }, { status: 403 })
  }

  // Reconstruct target URL — git's Smart HTTP needs the query string
  // (?service=git-upload-pack) preserved verbatim.
  const url = new URL(`https://${host}/${rest.join('/')}`)
  const incoming = new URL(req.url)
  url.search = incoming.search

  const headers = new Headers()
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
  }
  if (req.method === 'POST') {
    init.body = await req.arrayBuffer()
  }

  const upstream = await fetch(url.toString(), init)

  const outHeaders = new Headers()
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h)
    if (v) outHeaders.set(h, v)
  }
  // CORS — opens the response back up to the browser. The fetch from
  // isomorphic-git originated from the same noteser origin, so this
  // is reasonable.
  outHeaders.set('Access-Control-Allow-Origin', '*')
  outHeaders.set('Access-Control-Allow-Headers', 'authorization, content-type, accept, user-agent, git-protocol')
  outHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx)
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, accept, user-agent, git-protocol',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  })
}
