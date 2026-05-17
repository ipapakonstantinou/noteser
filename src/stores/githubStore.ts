import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GitHubUser } from '@/types'

// Stores the user's GitHub OAuth token + identity.
// SECURITY NOTE: localStorage is readable by any script on the page; any XSS
// would expose the token. Same trust model Obsidian Git uses for client-only
// installs. Acceptable for a personal note tool, NOT for a multi-tenant SaaS.
interface GitHubState {
  token: string | null
  user: GitHubUser | null
  connectedAt: number | null
  setSession: (token: string, user: GitHubUser) => void
  disconnect: () => void
}

export const useGitHubStore = create<GitHubState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      connectedAt: null,
      setSession: (token, user) => set({ token, user, connectedAt: Date.now() }),
      disconnect: () => set({ token: null, user: null, connectedAt: null }),
    }),
    {
      name: 'noteser-github',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        connectedAt: state.connectedAt,
      }),
    },
  ),
)
