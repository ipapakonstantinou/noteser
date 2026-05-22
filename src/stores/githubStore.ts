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

interface GitHubState {
  token: string | null
  user: GitHubUser | null
  connectedAt: number | null
  syncRepo: SyncRepo | null
  lastSyncedAt: number | null
  lastCommitSha: string | null
  repoSyncStates: Record<string, RepoSyncState>
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
  setSession: (token: string, user: GitHubUser, scopes?: string[] | null) => void
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
      tokenScopes: null,
      isSyncing: false,
      setSession: (token, user, scopes = null) => set({
        token,
        user,
        connectedAt: Date.now(),
        tokenScopes: scopes,
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
      }),
    },
  ),
)
