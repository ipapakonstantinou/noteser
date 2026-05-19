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
  setSession: (token: string, user: GitHubUser) => void
  setSyncRepo: (repo: SyncRepo | null) => void
  recordSync: (commitSha: string) => void
  disconnect: () => void
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
      setSession: (token, user) => set({ token, user, connectedAt: Date.now() }),
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
        repoSyncStates: {},
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
      }),
    },
  ),
)
