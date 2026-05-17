import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GitHubUser, SyncRepo } from '@/types'

// Stores the user's GitHub OAuth token + identity + chosen sync repo.
// SECURITY NOTE: localStorage is readable by any script on the page; any XSS
// would expose the token. Same trust model Obsidian Git uses for client-only
// installs. Acceptable for a personal note tool, NOT for a multi-tenant SaaS.
interface GitHubState {
  token: string | null
  user: GitHubUser | null
  connectedAt: number | null
  syncRepo: SyncRepo | null
  lastSyncedAt: number | null
  lastCommitSha: string | null
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
      setSession: (token, user) => set({ token, user, connectedAt: Date.now() }),
      setSyncRepo: (repo) => set({ syncRepo: repo, lastSyncedAt: null, lastCommitSha: null }),
      recordSync: (commitSha) => set({ lastSyncedAt: Date.now(), lastCommitSha: commitSha }),
      disconnect: () => set({
        token: null, user: null, connectedAt: null,
        syncRepo: null, lastSyncedAt: null, lastCommitSha: null,
      }),
    }),
    {
      name: 'noteser-github',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        connectedAt: state.connectedAt,
        syncRepo: state.syncRepo,
        lastSyncedAt: state.lastSyncedAt,
        lastCommitSha: state.lastCommitSha,
      }),
    },
  ),
)
