/**
 * @jest-environment node
 *
 * Coverage for the "incremental gist scope" security follow-up:
 *
 *   1. The device-code proxy defaults to `repo` and only forwards
 *      `repo gist` when the caller explicitly opts in (and never
 *      forwards anything else).
 *   2. `startDeviceFlow` carries the optional scope through to the
 *      proxy, but omits the body for plain sign-in.
 *   3. `fetchGitHubUserAndScopes` parses the `X-OAuth-Scopes` response
 *      header into a normalised string array.
 *   4. `useGitHubStore` persists `tokenScopes` and the `hasGistScope`
 *      helper answers the right question.
 *
 * Uses the node test environment so native Response/Request/Headers
 * are available — jsdom strips them.
 */

import { POST as deviceCodePOST } from '../app/api/github/device-code/route'
import {
  startDeviceFlow,
  fetchGitHubUserAndScopes,
  parseOAuthScopesHeader,
} from '../utils/github'
import { useGitHubStore, hasGistScope } from '../stores/githubStore'

// ── shared stubs ────────────────────────────────────────────────────────────

const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
  fetchMock.mockReset()
  ;(global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = 'test-client-id'
})

afterAll(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})

// Hand-roll a Request stub the route handler is happy with. Mimics the
// same shape originAllowlist.test.ts uses, with both `headers.get()` and
// JSON-body methods so the handler can `await request.text()`.
function makeRequest(opts: { origin?: string; body?: unknown } = {}): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    ...(opts.origin ? { origin: opts.origin } : {}),
  })
  const bodyStr = opts.body == null ? '' : JSON.stringify(opts.body)
  return new Request('https://noteser.app/api/github/device-code', {
    method: 'POST',
    headers,
    body: bodyStr || undefined,
  })
}

function githubDeviceCodeResponse(): Response {
  return new Response(
    JSON.stringify({
      device_code: 'dc',
      user_code: 'AAAA-BBBB',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

// ── 1. device-code route — scope allowlist ──────────────────────────────────

describe('POST /api/github/device-code — scope handling', () => {
  test('defaults to `repo` when no body is sent', async () => {
    fetchMock.mockResolvedValueOnce(githubDeviceCodeResponse())
    const res = await deviceCodePOST(makeRequest({ origin: 'https://noteser.app' }))
    expect(res.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0]
    const sent = JSON.parse(init.body as string)
    expect(sent.scope).toBe('repo')
    // Default scope MUST NOT silently include `gist` — that would
    // re-introduce the security regression we're fixing.
    expect(sent.scope).not.toContain('gist')
  })

  test('forwards `repo gist` when the caller asks for it', async () => {
    fetchMock.mockResolvedValueOnce(githubDeviceCodeResponse())
    await deviceCodePOST(
      makeRequest({ origin: 'https://noteser.app', body: { scope: 'repo gist' } }),
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string).scope).toBe('repo gist')
  })

  test('downgrades to `repo` when an unlisted scope is requested', async () => {
    // Defence in depth — same-origin guard already blocks third-party
    // callers, but if anything ever slips through, we must not let it
    // coax GitHub into issuing `admin:org` or `delete_repo` tokens.
    fetchMock.mockResolvedValueOnce(githubDeviceCodeResponse())
    await deviceCodePOST(
      makeRequest({ origin: 'https://noteser.app', body: { scope: 'admin:org' } }),
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string).scope).toBe('repo')
  })

  test('malformed JSON body falls back to the default `repo` scope', async () => {
    fetchMock.mockResolvedValueOnce(githubDeviceCodeResponse())
    // Build a request whose body fails JSON.parse — Request itself
    // accepts the string, the handler hits the catch.
    const req = new Request('https://noteser.app/api/github/device-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://noteser.app' },
      body: 'not json{',
    })
    const res = await deviceCodePOST(req)
    expect(res.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string).scope).toBe('repo')
  })

  test('rejects cross-origin callers regardless of requested scope', async () => {
    const res = await deviceCodePOST(
      makeRequest({ origin: 'https://evil.example.com', body: { scope: 'repo gist' } }),
    )
    expect(res.status).toBe(403)
    // The upstream fetch must not have been called at all — same-origin
    // check happens before any forwarding.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 2. startDeviceFlow forwarding ───────────────────────────────────────────

describe('startDeviceFlow — scope forwarding', () => {
  test('omits the body for plain sign-in', async () => {
    fetchMock.mockResolvedValueOnce(githubDeviceCodeResponse())
    await startDeviceFlow()
    const [, init] = fetchMock.mock.calls[0]
    // No body → preserves backward compatibility with the route's
    // "no body? default to repo" path.
    expect(init.body).toBeUndefined()
  })

  test('forwards `repo gist` scope to the proxy when explicitly requested', async () => {
    fetchMock.mockResolvedValueOnce(githubDeviceCodeResponse())
    await startDeviceFlow('repo gist')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ scope: 'repo gist' })
  })
})

// ── 3. parseOAuthScopesHeader + fetchGitHubUserAndScopes ────────────────────

describe('parseOAuthScopesHeader', () => {
  test('null header returns null (header was absent)', () => {
    expect(parseOAuthScopesHeader(null)).toBeNull()
  })

  test('empty string returns empty array (token has no scopes)', () => {
    // Distinguishing "no header" from "empty header" matters for the
    // hasGistScope check downstream — an empty list is definitely
    // missing gist, but means the token IS recorded.
    expect(parseOAuthScopesHeader('')).toEqual([])
  })

  test('parses comma-separated scopes and lowercases them', () => {
    expect(parseOAuthScopesHeader('repo, Gist, read:user')).toEqual(['repo', 'gist', 'read:user'])
  })

  test('skips empty entries from trailing commas', () => {
    expect(parseOAuthScopesHeader('repo,,gist,')).toEqual(['repo', 'gist'])
  })
})

describe('fetchGitHubUserAndScopes', () => {
  test('returns user plus parsed scopes from X-OAuth-Scopes', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 1, login: 'octocat', name: 'Mona', avatar_url: 'a' }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-oauth-scopes': 'repo, gist',
          },
        },
      ),
    )
    const { user, scopes } = await fetchGitHubUserAndScopes('tok')
    expect(user.login).toBe('octocat')
    expect(scopes).toEqual(['repo', 'gist'])
  })

  test('returns scopes=null when GitHub omits the X-OAuth-Scopes header', async () => {
    // Some corporate proxies strip non-standard headers. Treat as
    // unknown so the caller can decide whether to gate or attempt.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, login: 'octocat', name: null, avatar_url: 'a' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const { scopes } = await fetchGitHubUserAndScopes('tok')
    expect(scopes).toBeNull()
  })
})

// ── 4. githubStore — tokenScopes persistence + hasGistScope ────────────────

describe('useGitHubStore — tokenScopes', () => {
  beforeEach(() => {
    // Reset between tests — the store is a module-level singleton.
    useGitHubStore.setState({
      token: null,
      user: null,
      connectedAt: null,
      syncRepo: null,
      lastSyncedAt: null,
      lastCommitSha: null,
      repoSyncStates: {},
      tokenScopes: null,
      isSyncing: false,
    })
  })

  test('setSession records the scopes the caller passes in', () => {
    useGitHubStore.getState().setSession('tok', { id: 1, login: 'octocat', name: null, avatar_url: '' }, ['repo', 'gist'])
    expect(useGitHubStore.getState().tokenScopes).toEqual(['repo', 'gist'])
  })

  test('setSession with no scopes argument leaves tokenScopes as null (unknown)', () => {
    useGitHubStore.getState().setSession('tok', { id: 1, login: 'octocat', name: null, avatar_url: '' })
    expect(useGitHubStore.getState().tokenScopes).toBeNull()
  })

  test('setTokenScopes updates scopes without churning the rest of the session', () => {
    useGitHubStore.getState().setSession('tok', { id: 1, login: 'octocat', name: null, avatar_url: '' }, ['repo'])
    useGitHubStore.getState().setTokenScopes(['repo', 'gist'])
    const s = useGitHubStore.getState()
    expect(s.tokenScopes).toEqual(['repo', 'gist'])
    expect(s.token).toBe('tok')
    expect(s.user?.login).toBe('octocat')
  })

  test('disconnect clears tokenScopes', () => {
    useGitHubStore.getState().setSession('tok', { id: 1, login: 'octocat', name: null, avatar_url: '' }, ['repo', 'gist'])
    useGitHubStore.getState().disconnect()
    expect(useGitHubStore.getState().tokenScopes).toBeNull()
  })
})

describe('hasGistScope helper', () => {
  test('true only when the list includes "gist"', () => {
    expect(hasGistScope(['repo', 'gist'])).toBe(true)
    expect(hasGistScope(['repo'])).toBe(false)
    expect(hasGistScope([])).toBe(false)
  })

  test('null / undefined scopes count as missing — old tokens, mid-upgrade UX', () => {
    expect(hasGistScope(null)).toBe(false)
    expect(hasGistScope(undefined)).toBe(false)
  })
})
