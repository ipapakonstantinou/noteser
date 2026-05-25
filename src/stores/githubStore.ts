import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GitHubUser, SyncRepo } from '@/types'
import { STORAGE_KEYS } from '@/utils/storageKeys'

// Stores the user's GitHub OAuth token + identity + chosen sync repo.
// SECURITY NOTE: localStorage is readable by any script on the page; any XSS
// would expose the token. Same trust model Obsidian Git uses for client-only
// installs. Acceptable for a personal note tool, NOT for a multi-tenant SaaS.

// Last-sync metadata for a single repo. We mirror the active repo's entry
// into the top-level `lastSyncedAt` / `lastCommitSha` so existing readers
// (sidebar, dirty-state check) don't need to know about the map; the map
// just makes the values survive switching between repos.
interface RepoSyncState {
  lastSyncedAt: number | null
  lastCommitSha: string | null
}

function repoKey(repo: SyncRepo | null): string | null {
  return repo ? `${repo.owner}/${repo.name}` : null
}

// Full token bundle as issued by GitHub's OAuth token endpoint. For a GitHub
// App that issues EXPIRING user tokens this carries `expires_in` +
// `refresh_token` + `refresh_token_expires_in`; for non-expiring tokens
// (classic OAuth Apps, fine-grained PATs pasted by hand) only `access_token`
// is present and the rest are absent. See `refreshToken` handling below.
export interface GitHubTokenSet {
  accessToken: string
  // Absolute epoch-ms at which the access token expires. Null when the token
  // does not expire (PATs / classic non-expiring OAuth tokens) — in that case
  // we NEVER attempt a refresh and behave exactly as the pre-refresh build.
  accessTokenExpiresAt: number | null
  // The rotating refresh token. GitHub issues a NEW one on every refresh, so
  // we always persist the latest. Null when none was issued.
  refreshToken: string | null
  // Absolute epoch-ms at which the refresh token itself expires (~6 months for
  // GitHub Apps). Once past this, even a refresh fails → full reconnect.
  refreshTokenExpiresAt: number | null
}

interface GitHubState {
  token: string | null
  user: GitHubUser | null
  connectedAt: number | null
  syncRepo: SyncRepo | null
  lastSyncedAt: number | null
  lastCommitSha: string | null
  repoSyncStates: Record<string, RepoSyncState>
  // refresh-token handling: when GitHub issued an EXPIRING user access token it
  // also returned a refresh_token. We persist the absolute expiry of the access
  // token and the (rotating) refresh token so the app can renew silently
  // instead of logging the user out every ~8h.
  //
  // ALL of these are null for non-expiring tokens (pasted PATs, classic OAuth
  // tokens). The renewal layer treats "no refreshToken OR no
  // accessTokenExpiresAt" as "this token never expires" and skips every refresh
  // path — guaranteeing the PAT/classic flow is unchanged.
  accessTokenExpiresAt: number | null
  refreshToken: string | null
  refreshTokenExpiresAt: number | null
  // OAuth scopes attached to `token`, parsed from the `X-OAuth-Scopes`
  // header when the token was first received. Normalised to trimmed
  // lowercase strings (e.g. `['repo', 'gist']`).
  //
  // `null` means "unknown" — typically a token persisted by an older
  // build that didn't record scopes. Callers should treat null as
  // "assume legacy `repo` only" and try the upgrade flow if a
  // gist-only feature returns GistScopeError. See PublishGistModal.
  tokenScopes: string[] | null
  // Global guard: true while any sync is in flight. Lifted out of the
  // per-hook syncState because multiple components (Sidebar, GitHubView,
  // useAutoSync) each instantiate useGitHubSync — without a shared flag,
  // a manual click + an auto-sync tick would fire two concurrent syncs.
  // NOT persisted (resets to false on every reload).
  isSyncing: boolean
  setSession: (token: string, user: GitHubUser, scopes?: string[] | null, tokens?: GitHubTokenSet | null) => void
  // Apply a rotated token bundle after a successful refresh, WITHOUT touching
  // user/scopes/connectedAt (those are unchanged by a refresh). GitHub rotates
  // the refresh token on every use, so the new one is persisted here too.
  applyRefreshedTokens: (tokens: GitHubTokenSet) => void
  setTokenScopes: (scopes: string[] | null) => void
  setSyncRepo: (repo: SyncRepo | null) => void
  recordSync: (commitSha: string) => void
  setIsSyncing: (value: boolean) => void
  disconnect: () => void
}

/** True iff `scopes` includes the `gist` capability. Null = unknown → false. */
export function hasGistScope(scopes: string[] | null | undefined): boolean {
  return Array.isArray(scopes) && scopes.includes('gist')
}

export const useGitHubStore = create<GitHubState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      connectedAt: null,
      syncRepo: null,
      lastSyncedAt: null,
      lastCommitSha: null,
      repoSyncStates: {},
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      tokenScopes: null,
      isSyncing: false,
      setSession: (token, user, scopes = null, tokens = null) => set({
        token,
        user,
        connectedAt: Date.now(),
        tokenScopes: scopes,
        // When the auth path captured an expiring token bundle, persist it.
        // When it didn't (PAT paste, classic token, or a caller that doesn't
        // pass tokens), explicitly clear the refresh fields so a stale bundle
        // from a previous session can never linger against a new token.
        accessTokenExpiresAt: tokens?.accessTokenExpiresAt ?? null,
        refreshToken: tokens?.refreshToken ?? null,
        refreshTokenExpiresAt: tokens?.refreshTokenExpiresAt ?? null,
      }),
      applyRefreshedTokens: (tokens) => set({
        token: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      }),
      setTokenScopes: (scopes) => set({ tokenScopes: scopes }),
      setIsSyncing: (value) => set({ isSyncing: value }),
      setSyncRepo: (repo) => set(state => {
        const currentKey = repoKey(state.syncRepo)
        const nextKey = repoKey(repo)
        const repoSyncStates = { ...state.repoSyncStates }
        if (currentKey) {
          // Snapshot the outgoing repo's sync metadata so it's still here
          // when the user switches back.
          repoSyncStates[currentKey] = {
            lastSyncedAt: state.lastSyncedAt,
            lastCommitSha: state.lastCommitSha,
          }
        }
        const restored = nextKey ? repoSyncStates[nextKey] : undefined
        return {
          syncRepo: repo,
          lastSyncedAt: restored?.lastSyncedAt ?? null,
          lastCommitSha: restored?.lastCommitSha ?? null,
          repoSyncStates,
        }
      }),
      recordSync: (commitSha) => set(state => {
        const now = Date.now()
        const key = repoKey(state.syncRepo)
        const repoSyncStates = key
          ? { ...state.repoSyncStates, [key]: { lastSyncedAt: now, lastCommitSha: commitSha } }
          : state.repoSyncStates
        return { lastSyncedAt: now, lastCommitSha: commitSha, repoSyncStates }
      }),
      disconnect: () => set({
        token: null, user: null, connectedAt: null,
        syncRepo: null, lastSyncedAt: null, lastCommitSha: null,
        repoSyncStates: {}, tokenScopes: null,
        accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null,
      }),
    }),
    {
      name: STORAGE_KEYS.github,
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        connectedAt: state.connectedAt,
        syncRepo: state.syncRepo,
        lastSyncedAt: state.lastSyncedAt,
        lastCommitSha: state.lastCommitSha,
        repoSyncStates: state.repoSyncStates,
        tokenScopes: state.tokenScopes,
        accessTokenExpiresAt: state.accessTokenExpiresAt,
        refreshToken: state.refreshToken,
        refreshTokenExpiresAt: state.refreshTokenExpiresAt,
      }),
    },
  ),
)
