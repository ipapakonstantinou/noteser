/**
 * @jest-environment node
 *
 * tokenRefreshOrchestrator.test.ts
 *
 * Covers utils/tokenRefresh.ts — the centralised renewal layer:
 *   - getValidGitHubToken (PROACTIVE): refreshes a near-expiry token, passes a
 *     comfortable token through untouched, and passes non-expiring (PAT/classic)
 *     tokens through with NO refresh call.
 *   - withTokenRefresh (REACTIVE): on a 401 it refreshes once and retries; a
 *     second 401 → ReconnectRequiredError; a non-refreshable token's 401 →
 *     ReconnectRequiredError with no refresh attempt (backward compat).
 *
 * We mock refreshAccessToken so no proxy/network is touched, and drive the real
 * Zustand store so the persist/apply wiring is exercised end to end.
 */

const refreshAccessTokenMock = jest.fn()
jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github')
  return {
    ...actual,
    refreshAccessToken: (...args: unknown[]) => refreshAccessTokenMock(...args),
  }
})

import { useGitHubStore, type GitHubTokenSet } from '../stores/githubStore'
import { GitHubAPIError } from '../utils/github'
import {
  getValidGitHubToken,
  withTokenRefresh,
  ReconnectRequiredError,
  isRefreshable,
  isAuthError,
  _resetInFlightRefresh,
  REFRESH_SKEW_MS,
} from '../utils/tokenRefresh'

const USER = { login: 'octocat', avatar_url: '', name: null, id: 1 }

function setExpiringSession(opts: { accessExpiresInMs: number; refreshToken?: string | null }) {
  const now = Date.now()
  useGitHubStore.getState().setSession('gho_access', USER, ['repo'], {
    accessToken: 'gho_access',
    accessTokenExpiresAt: now + opts.accessExpiresInMs,
    refreshToken: opts.refreshToken === undefined ? 'ghr_refresh' : opts.refreshToken,
    refreshTokenExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
  })
}

function setPatSession() {
  // PAT / classic: setSession with no token bundle → all refresh fields null.
  useGitHubStore.getState().setSession('github_pat_xyz', USER, null)
}

beforeEach(() => {
  refreshAccessTokenMock.mockReset()
  _resetInFlightRefresh()
  useGitHubStore.getState().disconnect()
})

describe('isRefreshable', () => {
  test('true only with both a refresh token and an access expiry', () => {
    expect(isRefreshable({ token: 't', refreshToken: 'r', accessTokenExpiresAt: 1, refreshTokenExpiresAt: 2 })).toBe(true)
    expect(isRefreshable({ token: 't', refreshToken: null, accessTokenExpiresAt: 1, refreshTokenExpiresAt: null })).toBe(false)
    expect(isRefreshable({ token: 't', refreshToken: 'r', accessTokenExpiresAt: null, refreshTokenExpiresAt: null })).toBe(false)
  })
})

describe('getValidGitHubToken — proactive', () => {
  test('returns a comfortable token unchanged, no refresh', async () => {
    setExpiringSession({ accessExpiresInMs: REFRESH_SKEW_MS + 60_000 })
    const tok = await getValidGitHubToken()
    expect(tok).toBe('gho_access')
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })

  test('refreshes when within the skew window and applies the rotated set', async () => {
    setExpiringSession({ accessExpiresInMs: 60_000 }) // < 5min skew
    const rotated: GitHubTokenSet = {
      accessToken: 'gho_rotated',
      accessTokenExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
      refreshToken: 'ghr_rotated',
      refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }
    refreshAccessTokenMock.mockResolvedValue(rotated)

    const tok = await getValidGitHubToken()

    expect(refreshAccessTokenMock).toHaveBeenCalledWith('ghr_refresh')
    expect(tok).toBe('gho_rotated')
    // Store now holds the rotated bundle (refresh token was rotated too).
    const s = useGitHubStore.getState()
    expect(s.token).toBe('gho_rotated')
    expect(s.refreshToken).toBe('ghr_rotated')
  })

  test('PAT / classic token is returned verbatim with NO refresh', async () => {
    setPatSession()
    const tok = await getValidGitHubToken()
    expect(tok).toBe('github_pat_xyz')
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })

  test('no token at all → ReconnectRequiredError', async () => {
    await expect(getValidGitHubToken()).rejects.toBeInstanceOf(ReconnectRequiredError)
  })

  test('expired refresh token → ReconnectRequiredError without calling refresh', async () => {
    const now = Date.now()
    useGitHubStore.getState().setSession('gho_access', USER, ['repo'], {
      accessToken: 'gho_access',
      accessTokenExpiresAt: now + 1_000, // near expiry → wants refresh
      refreshToken: 'ghr_refresh',
      refreshTokenExpiresAt: now - 1_000, // but the refresh token is already dead
    })
    await expect(getValidGitHubToken()).rejects.toBeInstanceOf(ReconnectRequiredError)
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })

  test('concurrent near-expiry callers share ONE refresh', async () => {
    setExpiringSession({ accessExpiresInMs: 1_000 })
    let resolve!: (v: GitHubTokenSet) => void
    refreshAccessTokenMock.mockImplementation(() => new Promise<GitHubTokenSet>((r) => { resolve = r }))

    const p1 = getValidGitHubToken()
    const p2 = getValidGitHubToken()
    resolve({
      accessToken: 'gho_rotated',
      accessTokenExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
      refreshToken: 'ghr_rotated',
      refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
    const [t1, t2] = await Promise.all([p1, p2])

    expect(t1).toBe('gho_rotated')
    expect(t2).toBe('gho_rotated')
    // The dedupe guarantees a single exchange even with two concurrent callers.
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1)
  })
})

describe('isAuthError', () => {
  test('recognises a 401 GitHubAPIError', () => {
    expect(isAuthError(new GitHubAPIError(401, 'op', 'Bad credentials', null, null))).toBe(true)
  })
  test('recognises a 403 "Bad credentials" as auth, but not a generic 403', () => {
    expect(isAuthError(new GitHubAPIError(403, 'op', 'Bad credentials', null, null))).toBe(true)
    expect(isAuthError(new GitHubAPIError(403, 'op', 'Resource not accessible', null, null))).toBe(false)
  })
  test('non-auth errors are not auth errors', () => {
    expect(isAuthError(new Error('boom'))).toBe(false)
    expect(isAuthError(new GitHubAPIError(404, 'op', 'Not found', null, null))).toBe(false)
  })
})

describe('withTokenRefresh — reactive', () => {
  test('passes through on success', async () => {
    setExpiringSession({ accessExpiresInMs: REFRESH_SKEW_MS + 60_000 })
    const out = await withTokenRefresh(async (tok) => `ran-with:${tok}`)
    expect(out).toBe('ran-with:gho_access')
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })

  test('on 401, refreshes once and retries with the fresh token', async () => {
    setExpiringSession({ accessExpiresInMs: REFRESH_SKEW_MS + 60_000 })
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: 'gho_rotated',
      accessTokenExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
      refreshToken: 'ghr_rotated',
      refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })

    let calls = 0
    const out = await withTokenRefresh(async (tok) => {
      calls += 1
      if (calls === 1) throw new GitHubAPIError(401, 'Read tree', 'Bad credentials', null, null)
      return `ok:${tok}`
    })

    expect(calls).toBe(2)
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1)
    expect(out).toBe('ok:gho_rotated')
  })

  test('two consecutive 401s → ReconnectRequiredError (no infinite loop)', async () => {
    setExpiringSession({ accessExpiresInMs: REFRESH_SKEW_MS + 60_000 })
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: 'gho_rotated',
      accessTokenExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
      refreshToken: 'ghr_rotated',
      refreshTokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })

    let calls = 0
    await expect(
      withTokenRefresh(async () => {
        calls += 1
        throw new GitHubAPIError(401, 'Read tree', 'Bad credentials', null, null)
      }),
    ).rejects.toBeInstanceOf(ReconnectRequiredError)

    // Exactly two attempts: original + one retry. Never loops.
    expect(calls).toBe(2)
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1)
  })

  test('PAT 401 surfaces ReconnectRequiredError with NO refresh attempt', async () => {
    setPatSession()
    let calls = 0
    await expect(
      withTokenRefresh(async () => {
        calls += 1
        throw new GitHubAPIError(401, 'Read tree', 'Bad credentials', null, null)
      }),
    ).rejects.toBeInstanceOf(ReconnectRequiredError)

    expect(calls).toBe(1) // single attempt, no retry
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })

  test('non-auth errors propagate untouched', async () => {
    setExpiringSession({ accessExpiresInMs: REFRESH_SKEW_MS + 60_000 })
    await expect(
      withTokenRefresh(async () => { throw new GitHubAPIError(422, 'Update ref', 'not a fast forward', null, null) }),
    ).rejects.toMatchObject({ status: 422 })
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })
})
