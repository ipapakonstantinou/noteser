/**
 * @jest-environment jsdom
 *
 * githubStore carries the active sync connection. Phase 2 of the multi-host
 * plan adds `host`/`baseUrl` so the sync pipeline can select a provider from
 * the connection instead of hardcoding GitHub.
 *
 * The load-bearing invariant for existing users: the store has NO persist
 * version, so Zustand merges a persisted blob over the initial state. A blob
 * written by an older build (no `host` key) must therefore rehydrate to the
 * default `host: 'github'`, `baseUrl: null` — i.e. behave exactly as before.
 * This test pins that so a future persist-version bump can't silently break it.
 */

import { STORAGE_KEYS } from '../utils/storageKeys'

describe('githubStore host/baseUrl connection state', () => {
  beforeEach(() => {
    localStorage.clear()
    jest.resetModules()
  })

  it('defaults host to "github" and baseUrl to null on a fresh store', async () => {
    const { useGitHubStore } = await import('../stores/githubStore')
    const state = useGitHubStore.getState()
    expect(state.host).toBe('github')
    expect(state.baseUrl).toBeNull()
  })

  it('rehydrates a legacy persisted blob (no host key) to host "github"', async () => {
    // Simulate a blob written by an older build: a connected GitHub user with
    // a sync repo but no `host`/`baseUrl` keys.
    localStorage.setItem(
      STORAGE_KEYS.github,
      JSON.stringify({
        version: 0,
        state: {
          token: 'legacy-token',
          user: { id: 1, login: 'octocat', name: 'Octo', avatar_url: '' },
          connectedAt: 123,
          syncRepo: {
            owner: 'octocat',
            name: 'vault',
            branch: 'main',
            isPrivate: false
          },
          lastSyncedAt: null,
          lastCommitSha: null,
          repoSyncStates: {},
          tokenScopes: ['repo'],
          accessTokenExpiresAt: null,
          refreshToken: null,
          refreshTokenExpiresAt: null
        }
      })
    )

    const { useGitHubStore } = await import('../stores/githubStore')
    await useGitHubStore.persist.rehydrate()

    const state = useGitHubStore.getState()
    // The persisted fields are restored…
    expect(state.token).toBe('legacy-token')
    expect(state.syncRepo).toEqual({
      owner: 'octocat',
      name: 'vault',
      branch: 'main',
      isPrivate: false
    })
    // …and the missing host/baseUrl fall back to the initial defaults.
    expect(state.host).toBe('github')
    expect(state.baseUrl).toBeNull()
  })

  it('setHost updates host + baseUrl and persists them', async () => {
    const { useGitHubStore } = await import('../stores/githubStore')
    useGitHubStore.getState().setHost('forgejo', 'https://codeberg.org')

    expect(useGitHubStore.getState().host).toBe('forgejo')
    expect(useGitHubStore.getState().baseUrl).toBe('https://codeberg.org')

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEYS.github)!)
    expect(persisted.state.host).toBe('forgejo')
    expect(persisted.state.baseUrl).toBe('https://codeberg.org')
  })

  it('disconnect resets host/baseUrl to the GitHub defaults', async () => {
    const { useGitHubStore } = await import('../stores/githubStore')
    useGitHubStore.getState().setHost('forgejo', 'https://codeberg.org')
    useGitHubStore.getState().disconnect()

    expect(useGitHubStore.getState().host).toBe('github')
    expect(useGitHubStore.getState().baseUrl).toBeNull()
  })
})
