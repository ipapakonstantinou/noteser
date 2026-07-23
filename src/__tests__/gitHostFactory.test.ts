/**
 * @jest-environment node
 *
 * makeGitHostProvider picks the provider from a connection's host kind. This
 * is the seam that puts Forgejo in the sync flow — `useGitHubSync` calls it
 * instead of `new GitHubProvider`. The behavior-preserving invariant: with
 * host 'github' (the default for every existing user) it returns a
 * GitHubProvider exactly as before. Forgejo gets a ForgejoProvider honoring
 * the connection's baseUrl (null → the provider's codeberg.org default).
 */

import { makeGitHostProvider } from '../utils/gitHost'
import { GitHubProvider } from '../utils/gitHost/githubProvider'
import { ForgejoProvider } from '../utils/gitHost/forgejoProvider'

describe('makeGitHostProvider', () => {
  it('returns a GitHubProvider for host "github"', () => {
    const provider = makeGitHostProvider({
      host: 'github',
      token: 'gh-tok',
      baseUrl: null
    })
    expect(provider).toBeInstanceOf(GitHubProvider)
    expect(provider.kind).toBe('github')
    expect(provider.baseUrl).toBe('https://api.github.com')
  })

  it('ignores baseUrl on GitHub (always the GitHub API base)', () => {
    const provider = makeGitHostProvider({
      host: 'github',
      token: 'gh-tok',
      baseUrl: 'https://example.test'
    })
    expect(provider).toBeInstanceOf(GitHubProvider)
    expect(provider.baseUrl).toBe('https://api.github.com')
  })

  it('returns a ForgejoProvider with the supplied baseUrl for host "forgejo"', () => {
    const provider = makeGitHostProvider({
      host: 'forgejo',
      token: 'pat-tok',
      baseUrl: 'https://forgejo.example.org'
    })
    expect(provider).toBeInstanceOf(ForgejoProvider)
    expect(provider.kind).toBe('forgejo')
    expect(provider.baseUrl).toBe('https://forgejo.example.org')
  })

  it('falls back to codeberg.org when forgejo baseUrl is null', () => {
    const provider = makeGitHostProvider({
      host: 'forgejo',
      token: 'pat-tok',
      baseUrl: null
    })
    expect(provider).toBeInstanceOf(ForgejoProvider)
    expect(provider.baseUrl).toBe('https://codeberg.org')
  })
})
