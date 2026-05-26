/**
 * @jest-environment node
 *
 * githubTokenRefresh.test.ts
 *
 * Covers the refresh-token primitives in utils/github.ts:
 *   - toTokenSet: maps a raw OAuth token response → persisted GitHubTokenSet,
 *     converting relative expires_in to absolute epoch-ms, and leaving
 *     refresh/expiry null for non-expiring tokens.
 *   - refreshAccessToken: POSTs the refresh grant via the proxy, returns the
 *     rotated token set, and throws a typed RefreshTokenError on failure.
 *
 * Node env so the global Fetch API (Response/Headers) is available; we mock the
 * underlying githubFetch so no real network call escapes.
 */

const githubFetchMock = jest.fn()
jest.mock('../utils/githubFetch', () => ({
  githubFetch: (...args: unknown[]) => githubFetchMock(...args),
}))

import { toTokenSet, refreshAccessToken, RefreshTokenError } from '../utils/github'

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  githubFetchMock.mockReset()
})

describe('toTokenSet', () => {
  test('maps an expiring token response to absolute expiries', () => {
    const now = 1_000_000
    const set = toTokenSet(
      {
        access_token: 'gho_new',
        expires_in: 28800, // 8h
        refresh_token: 'ghr_new',
        refresh_token_expires_in: 15897600, // ~6 months
      },
      now,
    )
    expect(set).not.toBeNull()
    expect(set!.accessToken).toBe('gho_new')
    expect(set!.accessTokenExpiresAt).toBe(now + 28800 * 1000)
    expect(set!.refreshToken).toBe('ghr_new')
    expect(set!.refreshTokenExpiresAt).toBe(now + 15897600 * 1000)
  })

  test('non-expiring token (PAT / classic) leaves refresh + expiry null', () => {
    const set = toTokenSet({ access_token: 'gho_classic', token_type: 'bearer', scope: 'repo' })
    expect(set).not.toBeNull()
    expect(set!.accessToken).toBe('gho_classic')
    expect(set!.accessTokenExpiresAt).toBeNull()
    expect(set!.refreshToken).toBeNull()
    expect(set!.refreshTokenExpiresAt).toBeNull()
  })

  test('returns null when no access_token present', () => {
    expect(toTokenSet({ error: 'authorization_pending' } as never)).toBeNull()
  })
})

describe('refreshAccessToken', () => {
  test('returns the rotated token set on success', async () => {
    const now = Date.now()
    githubFetchMock.mockResolvedValue(
      jsonRes(200, {
        access_token: 'gho_rotated',
        expires_in: 28800,
        refresh_token: 'ghr_rotated',
        refresh_token_expires_in: 15897600,
      }),
    )

    const set = await refreshAccessToken('ghr_old')

    // It POSTed the refresh grant to the proxy with the old refresh token.
    expect(githubFetchMock).toHaveBeenCalledWith(
      '/api/github/refresh-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refresh_token: 'ghr_old' }),
      }),
    )
    expect(set.accessToken).toBe('gho_rotated')
    expect(set.refreshToken).toBe('ghr_rotated')
    expect(set.accessTokenExpiresAt!).toBeGreaterThanOrEqual(now + 28800 * 1000 - 1000)
  })

  test('throws invalid RefreshTokenError when GitHub rejects the refresh token', async () => {
    githubFetchMock.mockResolvedValue(
      jsonRes(400, { error: 'bad_refresh_token', error_description: 'The refresh token is incorrect or expired.' }),
    )
    await expect(refreshAccessToken('ghr_dead')).rejects.toMatchObject({
      name: 'RefreshTokenError',
      code: 'invalid',
    })
  })

  test('throws rate_limited RefreshTokenError on a 429-style error', async () => {
    githubFetchMock.mockResolvedValue(
      jsonRes(429, { error: 'rate_limited', error_description: 'slow down' }),
    )
    await expect(refreshAccessToken('ghr')).rejects.toMatchObject({
      name: 'RefreshTokenError',
      code: 'rate_limited',
    })
  })

  test('wraps a network failure as a RefreshTokenError', async () => {
    githubFetchMock.mockRejectedValue(new Error('connection reset'))
    const err = await refreshAccessToken('ghr').catch((e) => e)
    expect(err).toBeInstanceOf(RefreshTokenError)
    expect(err.code).toBe('network')
  })
})
