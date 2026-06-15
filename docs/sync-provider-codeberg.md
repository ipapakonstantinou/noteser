# Adding Codeberg (and other git hosts) as a sync destination

A short guide for contributors. The goal: let Noteser sync a vault to
**Codeberg** (a [Forgejo](https://forgejo.org/) / Gitea host) in addition to
GitHub.

**TL;DR** — Do it in **core**, not as a plugin. The plugin API has no sync
extension point (plugins can only add commands, sidebar panels, code-block
renderers, fullscreen views, and read/write the vault). Making a sync
destination a plugin would mean first designing a whole sync-provider plugin
API — out of scope. The clean core approach is a small **provider interface**:
GitHub becomes provider #1, Codeberg #2.

---

## What already works for any git host (reuse, do not touch)

The actual git transport is host-agnostic and needs **no per-provider code**:

- **Clone / push / pull** run through [isomorphic-git](https://isomorphic-git.org/)
  over Smart HTTP — see `src/utils/inBrowserGit.ts`. Pushes are routed through
  the CORS proxy at `src/app/api/git-proxy/[...path]/route.ts`.
- **Auth on push** is HTTPS basic auth: `onAuth` returns
  `{ username, password: token }` (`inBrowserGit.ts`). GitHub uses
  `username: 'x-access-token'`; Codeberg/Forgejo accepts your **username +
  a personal access token** as the password. So the only provider difference
  here is the username string.
- The sync **brains** are host-agnostic too: note serialization, path
  derivation, 3-way conflict classification, and optional vault encryption all
  live in `src/utils/githubSync/internal.ts` and `syncClassify.ts` and operate
  on git data, not on GitHub.

## The one required core change (security boundary)

Add the host to the proxy allowlist — a plugin can **not** do this, and it must
stay server-side or the proxy becomes an open relay.

`src/app/api/git-proxy/[...path]/route.ts`:

```ts
const ALLOWED_HOSTS = new Set([
  'github.com',
  'codeberg.org',   // add this
])
```

(For self-hosted Forgejo instances we will later want this allowlist to be
configurable; for codeberg.org a literal entry is fine.)

## What is GitHub-specific today (this is the work)

Everything GitHub-API-bound lives in a handful of files. These are the pieces
a Codeberg provider must supply an equivalent for. Good news: **Gitea/Forgejo
exposes a REST API that closely mirrors GitHub's**, including the Git Data API
(`/repos/{owner}/{repo}/git/...`), so most calls map almost 1:1.

| Concern | GitHub file / fn | Codeberg / Forgejo equivalent |
|---|---|---|
| OAuth / token + user info | `src/utils/github.ts`: `startDeviceFlow`, `pollForToken`, `fetchGitHubUserAndScopes` | Forgejo OAuth2, or simplest: **paste a PAT** + `GET /api/v1/user` |
| List repos | `github.ts`: `listUserRepos` | `GET /api/v1/user/repos` |
| Create repo | `github.ts`: `createRepo` | `POST /api/v1/user/repos` |
| Read tree | `github.ts`: `getBranchRefSha`, `getCommitTreeSha`, `getTreeMap` | `GET /api/v1/repos/{o}/{r}/git/trees/{sha}?recursive=true` |
| Read blob | `github.ts`: `getBlobContent` | `GET /api/v1/repos/{o}/{r}/git/blobs/{sha}` |
| Write blob/tree/commit/ref | `github.ts`: `createBlob`, `createTree`, `createCommit`, `updateBranchRef` | same Git Data API shapes under `/api/v1/...` |
| Commit history | `src/utils/githubHistory.ts` | `GET /api/v1/repos/{o}/{r}/commits` |
| ETag conditional reads | `src/utils/githubETagCache.ts` | optional optimization; can no-op at first |
| Connect / repo-picker UI | `src/components/modals/GitHubAuthModal.tsx`, `GitHubRepoModal.tsx`, `settings/panels/GitHubPanel.tsx` | provider-aware variants |

> **Shortcut worth considering:** GitHub's blob/tree REST calls are an
> *optimization* (fewer round-trips, ETag caching). Since clone/push/pull
> already work via isomorphic-git for any host, a first Codeberg cut can lean
> on the isomorphic-git path and only implement the REST calls it truly needs
> (auth + list/create repo). Get it working first, optimize later.

## Suggested shape: a `SyncProvider` interface

There is **no provider abstraction today** — sync is wired straight to GitHub
(`useGitHubStore` in `src/stores/githubStore.ts`, and direct `github.ts` calls
from `syncPull.ts` / `syncPush.ts`). Rather than `if (provider === 'codeberg')`
branches scattered through the sync code, introduce one interface and make
GitHub the first implementation. Roughly:

```ts
// src/utils/sync/provider.ts (new)
export interface SyncProvider {
  id: 'github' | 'codeberg'
  // auth / identity
  validateToken(token: string): Promise<{ login: string; avatarUrl?: string }>
  // repo management (for the picker UI)
  listRepos(token: string): Promise<RepoSummary[]>
  createRepo(token: string, name: string, isPrivate: boolean): Promise<RepoSummary>
  // git data — the calls syncPull/syncPush make
  getBranchRefSha(token: string, repo: SyncRepo): Promise<string>
  getCommitTreeSha(token: string, repo: SyncRepo, commitSha: string): Promise<string>
  getTreeMap(token: string, repo: SyncRepo, treeSha: string): Promise<Map<string, string>>
  getBlobContent(token: string, repo: SyncRepo, blobSha: string): Promise<string>
  createBlob(token: string, repo: SyncRepo, content: string): Promise<string>
  createTree(token: string, repo: SyncRepo, entries: GitTreeEntry[], parentTreeSha?: string): Promise<string>
  createCommit(token: string, repo: SyncRepo, msg: string, treeSha: string, parentSha: string, author: GitAuthor): Promise<string>
  updateBranchRef(token: string, repo: SyncRepo, branch: string, commitSha: string): Promise<void>
  // host for the proxy URL + onAuth username
  gitHost: string            // 'github.com' | 'codeberg.org'
  pushUsername: string       // 'x-access-token' | <codeberg username>
}
```

Migration path that keeps the diff reviewable:

1. Define the interface and a `GitHubProvider` that just forwards to the
   existing `github.ts` functions (pure refactor, no behavior change — should
   pass the whole suite untouched).
2. Change `syncPull.ts` / `syncPush.ts` to take a `SyncProvider` instead of
   calling `github.ts` directly.
3. Store the chosen provider id alongside the repo config in
   `githubStore` (or a renamed `syncStore`).
4. Add `CodebergProvider` implementing the same interface against
   `/api/v1/...`.
5. Make the connect/repo-picker UI provider-aware (a provider dropdown).

## Testing

- Unit suite: `npm test` (the GitHub-provider refactor in step 1 must keep it
  green).
- **Live sync harness:** `npm run e2e:sync` runs a real clone/push/pull/
  round-trip against a live test repo. A new destination should pass an
  equivalent round-trip — please add a Codeberg variant (token via env, same
  shape as the existing GitHub one).
- App e2e: `npm run e2e`.

## Scope checklist for the PR

- [ ] `codeberg.org` added to `ALLOWED_HOSTS` in the git-proxy route
- [ ] `SyncProvider` interface + `GitHubProvider` (behavior-preserving refactor)
- [ ] `CodebergProvider` (Forgejo `/api/v1` REST)
- [ ] provider id persisted with the repo config
- [ ] provider-aware connect + repo-picker UI
- [ ] `e2e:sync` round-trip passing for Codeberg

Branch-per-feature as usual; open the PR against `dev`.
