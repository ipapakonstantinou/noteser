import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/utils/rateLimit'

// Proxies `GET /repos/{owner}/{repo}/zipball/{ref}`. The endpoint is normally
// callable directly from the browser, but GitHub returns a 302 redirect to
// `codeload.github.com` which strips the Authorization header on the cross-
// origin hop and doesn't set CORS headers on its responses — so the browser
// rejects the redirect and the fetch fails before any bytes arrive.
//
// Doing the fetch server-side sidesteps both issues: Node's fetch follows the
// redirect with the Authorization header intact, and we stream the archive
// straight back to the client over the same-origin connection.
//
// Rate-limited tightly because each call can pull tens of MB.
export async function POST(request: Request) {
  const limit = checkRateLimit(`zipball:${getClientIp(request)}`, { max: 6, windowMs: 60_000 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', error_description: 'Too many zipball downloads. Try again in a minute.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(limit.retryAfterMs / 1000).toString() } },
    )
  }

  const auth = request.headers.get('authorization')
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'unauthorized', error_description: 'Bearer token required' }, { status: 401 })
  }

  let body: { owner?: string; repo?: string; ref?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Body must be JSON' }, { status: 400 })
  }
  const { owner, repo, ref } = body
  if (!owner || !repo || !ref) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'owner, repo, and ref are required' },
      { status: 400 },
    )
  }
  // Guard against path-traversal attempts — these segments go straight into
  // the upstream URL. Refs allow `/` (branches like `feature/foo`); owner
  // and repo names do not. None of them may contain `..`.
  const safeOwnerRepo = /^[A-Za-z0-9._-]+$/
  const safeRef = /^[A-Za-z0-9._\-/]+$/
  if (
    !safeOwnerRepo.test(owner)
    || !safeOwnerRepo.test(repo)
    || !safeRef.test(ref)
    || ref.includes('..')
    || ref.startsWith('/')
    || ref.endsWith('/')
  ) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'owner/repo/ref contain disallowed characters' },
      { status: 400 },
    )
  }

  const upstream = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`,
    {
      headers: {
        Authorization: auth,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // Identify ourselves so GitHub doesn't 403 us as an unknown agent.
        'User-Agent': 'noteser-zipball-proxy',
      },
      // Node's fetch follows redirects by default; the Authorization header
      // is preserved on same-origin redirect chains within github.com /
      // codeload.github.com.
      redirect: 'follow',
    },
  )

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '')
    return NextResponse.json(
      { error: 'upstream_error', error_description: `GitHub returned ${upstream.status}: ${errText.slice(0, 200)}` },
      { status: upstream.status === 404 ? 404 : 502 },
    )
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/zip',
      // Don't bother trying to honor Content-Length — the upstream may not
      // set it when streaming, and the client just needs the bytes.
    },
  })
}
