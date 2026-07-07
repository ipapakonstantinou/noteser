// Public entry point for the git-host abstraction. Re-exports the seam types
// and both provider implementations, plus the factory that picks a provider
// from a connection's host kind. The sync pipeline imports `makeGitHostProvider`
// here rather than constructing a concrete provider, so the active host is a
// piece of connection state — not a hardcoded `new GitHubProvider`. See
// docs/multi-host-sync-plan.md → "Data model changes".

import type { GitHostProvider, HostKind } from './types'
import { GitHubProvider } from './githubProvider'
import { ForgejoProvider } from './forgejoProvider'

export * from './types'
export { GitHubProvider } from './githubProvider'
export { ForgejoProvider } from './forgejoProvider'

/** Build the provider for a connection. GitHub is the default — `baseUrl` is
 *  ignored there. For Forgejo a null/undefined baseUrl falls back to the
 *  provider's own default (codeberg.org). */
export function makeGitHostProvider(opts: {
  host: HostKind
  token: string
  baseUrl?: string | null
}): GitHostProvider {
  if (opts.host === 'forgejo') {
    return new ForgejoProvider(opts.token, opts.baseUrl ?? undefined)
  }
  return new GitHubProvider(opts.token)
}
