// Centralised GitHub token-renewal layer.
//
// noteser authenticates via the OAuth Device Flow. A GitHub App configured to
// issue EXPIRING user tokens hands back an access token (~8h) PLUS a
// refresh_token (~6 months). The store persists both (see githubStore:
// accessTokenExpiresAt / refreshToken / refreshTokenExpiresAt). This module is
// the one place that decides when to renew and applies the rotated tokens.
//
// Two entry points the rest of the app uses:
//   - getValidGitHubToken()  PROACTIVE: returns a usable access token, first
//     refreshing if the stored one is within the skew window of expiry.
//   - withTokenRefresh(fn)    REACTIVE: runs `fn(token)`; if it still 401s,
//     refreshes once and retries, then surfaces a reconnect-class error.
//
// BACKWARD COMPAT: a token with no refreshToken OR no accessTokenExpiresAt is
// treated as non-expiring (pasted PATs, classic OAuth tokens). For those we
// NEVER call the refresh endpoint — getValidGitHubToken returns the stored
// token verbatim and withTokenRefresh does a single attempt with no retry,
// behaving exactly as the pre-refresh build did.

import { useGitHubStore } from '@/stores/githubStore'
import { refreshAccessToken, RefreshTokenError, GitHubAPIError } from './github'

// How far ahead of expiry we proactively refresh. A sync can take tens of
// seconds; refreshing with 5 minutes of headroom guarantees the token won't
// lapse mid-operation.
export const REFRESH_SKEW_MS = 5 * 60 * 1000

// Raised when renewal is impossible (no refresh token, or the refresh itself
// failed terminally). The caller maps this to the existing reconnect flow.
export class ReconnectRequiredError extends Error {
  constructor(message = 'GitHub session expired — please reconnect.') {
    super(message)
    this.name = 'ReconnectRequiredError'
  }
}

// In-flight refresh dedupe: multiple concurrent callers (a sync + a gist
// publish, two tabs of the same operation) must not each POST the refresh
// endpoint — GitHub rotates the refresh token on every use, so a second
// concurrent exchange with the now-stale token would fail. We share one
// in-flight promise so concurrent callers all await the same renewal.
let inFlightRefresh: Promise<string> | null = null

interface RefreshFields {
  token: string | null
  accessTokenExpiresAt: number | null
  refreshToken: string | null
  refreshTokenExpiresAt: number | null
}

// True when the stored token is an expiring one we can renew (has both a
// refresh token and a recorded access-token expiry). PATs / classic tokens
// return false here and skip all refresh logic.
export function isRefreshable(s: RefreshFields): boolean {
  return !!s.refreshToken && s.accessTokenExpiresAt != null
}

// True when the access token is at/within REFRESH_SKEW_MS of expiry.
function isNearExpiry(s: RefreshFields, now: number): boolean {
  if (s.accessTokenExpiresAt == null) return false
  return s.accessTokenExpiresAt - now <= REFRESH_SKEW_MS
}

// Perform the actual refresh against the store's current refresh token, apply
// the rotated bundle, and return the new access token. Deduped via
// inFlightRefresh. Throws ReconnectRequiredError on terminal failure.
async function doRefresh(): Promise<string> {
  if (inFlightRefresh) return inFlightRefresh

  inFlightRefresh = (async () => {
    const state = useGitHubStore.getState()
    const refreshToken = state.refreshToken
    if (!refreshToken) {
      throw new ReconnectRequiredError('No refresh token — please reconnect GitHub.')
    }
    // Refresh token itself expired (~6 months) → only a reconnect can recover.
    if (state.refreshTokenExpiresAt != null && state.refreshTokenExpiresAt <= Date.now()) {
      throw new ReconnectRequiredError('Your GitHub authorization expired — please reconnect.')
    }
    try {
      const tokens = await refreshAccessToken(refreshToken)
      // Persist the rotated bundle (GitHub issues a NEW refresh token each time).
      useGitHubStore.getState().applyRefreshedTokens(tokens)
      return tokens.accessToken
    } catch (err) {
      if (err instanceof RefreshTokenError) {
        // A network/rate-limit blip is transient — propagate as-is so a retry
        // can succeed later; only invalid/config map to a hard reconnect.
        if (err.code === 'network' || err.code === 'rate_limited') throw err
        throw new ReconnectRequiredError(err.message)
      }
      throw err
    }
  })()

  try {
    return await inFlightRefresh
  } finally {
    inFlightRefresh = null
  }
}

// PROACTIVE renewal. Returns a usable access token, refreshing first when the
// stored one is within REFRESH_SKEW_MS of expiry. For non-expiring tokens
// (PATs / classic) returns the stored token unchanged with no network call.
// Throws ReconnectRequiredError when there is no token at all, or when a needed
// refresh fails terminally.
export async function getValidGitHubToken(now = Date.now()): Promise<string> {
  const s = useGitHubStore.getState()
  if (!s.token) throw new ReconnectRequiredError('Not connected to GitHub.')

  // Non-expiring token (PAT / classic): use verbatim, exactly as before.
  if (!isRefreshable(s)) return s.token

  // Expiring token that still has comfortable headroom: use as-is.
  if (!isNearExpiry(s, now)) return s.token

  // Within the skew window — refresh proactively before handing it out.
  return doRefresh()
}

// REACTIVE renewal. Runs `op(token)`; if it throws a 401-class error AND the
// token is refreshable, refreshes once and retries with the fresh token. If the
// retry also 401s — or the token isn't refreshable — the error propagates so
// the caller surfaces the reconnect flow. A single retry only: never loops.
//
// `op` receives the token to use so the retry can pass the rotated one. The
// proactive getValidGitHubToken() is called first, so under normal conditions
// the reactive path never fires; it is the safety net for clock skew, a token
// revoked server-side, or an expiry we didn't see coming.
export async function withTokenRefresh<T>(op: (token: string) => Promise<T>): Promise<T> {
  const token = await getValidGitHubToken()
  try {
    return await op(token)
  } catch (err) {
    if (!isAuthError(err)) throw err
    const s = useGitHubStore.getState()
    // Not refreshable (PAT/classic) → a 401 is genuine; surface reconnect.
    if (!isRefreshable(s)) {
      throw new ReconnectRequiredError(
        'GitHub rejected the token (401). Please reconnect or re-paste your token.',
      )
    }
    // Refresh once and retry exactly once.
    const fresh = await doRefresh()
    try {
      return await op(fresh)
    } catch (retryErr) {
      if (isAuthError(retryErr)) {
        throw new ReconnectRequiredError(
          'GitHub session could not be renewed — please reconnect.',
        )
      }
      throw retryErr
    }
  }
}

// Recognise a 401 (or "Bad credentials") from either our typed GitHubAPIError
// or a looser error/Response so the reactive path catches every shape a GitHub
// call surfaces.
export function isAuthError(err: unknown): boolean {
  if (err instanceof GitHubAPIError) {
    if (err.status === 401) return true
    // GitHub sometimes labels a revoked/expired token 403 with this message.
    if (err.status === 403 && /bad credentials/i.test(err.githubMessage ?? '')) return true
    return false
  }
  if (typeof err === 'object' && err !== null) {
    const status = (err as { status?: unknown }).status
    if (status === 401) return true
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && /bad credentials|401/i.test(message)) return true
  }
  return false
}

// Test hook: clear the in-flight dedupe between cases.
export function _resetInFlightRefresh(): void {
  inFlightRefresh = null
}
