// GitHubProvider: the GitHub implementation of the GitHostProvider seam.
//
// This is a mechanical WRAP of the existing functions in `../github.ts` —
// it delegates every call rather than reimplementing any HTTP. The repo
// read/write functions in github.ts take `(token, owner, repo, ...)`; this
// class binds the token at construction and maps a `SyncRepo {owner,name,
// branch}` onto those positional args.
//
// Tree/blob reads delegate to the ETag-conditional wrappers in
// `../githubETagCache` (which themselves fall back to the bare github.ts
// helpers on a cold cache), so GitHub's #69 conditional-request caching is
// encapsulated here and available to any caller of the provider — the pull
// pipeline never has to know about it. `getBlobBytes` has no conditional
// variant and stays on the bare helper.
//
// `commitChanges` reproduces the existing push flow that `githubSync/
// syncPush.ts` used to perform inline (createBlob → createTree →
// createCommit → updateBranchRef), mirroring its semantics: deletes are
// `sha:null` tree entries, the base tree is resolved from the parent commit,
// and the branch ref is fast-forwarded. It also keeps the GitHub-specific
// blob upload-cache and the no-op-tree skip that used to live in syncPush —
// both are pure GitHub-blob optimizations (Forgejo's ChangeFiles batch sends
// content directly, so they have no meaning there). See
// docs/multi-host-sync-plan.md.

import type { SyncRepo, GitHubRepo } from '@/types'
import {
  getBranchRefSha,
  getCommitTreeSha,
  getTreeMap,
  getBlobContent,
  getBlobBytes,
  fetchZipball,
  fetchGitHubUser,
  listUserRepos,
  listRepoBranches,
  getRepo as githubGetRepo,
  createRepo as githubCreateRepo,
  createBlob,
  createBlobBinary,
  createTree,
  createCommit,
  updateBranchRef,
  gitBlobSha,
  gitBlobShaBytes,
  type GitTreeEntry
} from '../github'
// The plain `getTreeMap`/`getBlobContent` above are the canonical reads used
// by the PUSH path — byte-identical to pre-seam behavior, no caching layer in
// the way (a stale tree during a push would risk a non-fast-forward commit).
// The `*Cached` methods below add the #69 ETag-conditional caching and are
// used only by the PULL path, where a re-sync of an unchanged repo should come
// back as cheap 304s. Forgejo has no ETag variant, so its provider aliases the
// cached methods to the plain reads. getBlobBytes has no conditional variant.
import {
  getBlobContentConditional,
  getTreeMapConditional
} from '../githubETagCache'
import type {
  GitHostProvider,
  HostKind,
  HostRepo,
  HostUser,
  CommitRequest,
  CommitResult
} from './types'

const GITHUB_API_BASE = 'https://api.github.com'

// In-memory cache of blob SHAs we've already uploaded to GitHub in this tab
// session. Git blob SHAs are content-addressable, so a hit here means GitHub
// already has that content — skip the redundant network round-trip. Survives
// across commitChanges calls within the tab (so a token-refresh retry skips
// blobs the first attempt already uploaded) but is cleared on a reload and
// after each successful commit. Indexed per-repo so two vaults don't share
// state. Lives at module scope (not on the instance) so a fresh provider
// built for a retry still sees the prior attempt's uploads.
const uploadedBlobShaCache = new Map<string, Set<string>>()

function repoCacheKey(repo: SyncRepo): string {
  return `${repo.owner}/${repo.name}#${repo.branch}`
}

function getUploadedShas(repo: SyncRepo): Set<string> {
  const key = repoCacheKey(repo)
  let set = uploadedBlobShaCache.get(key)
  if (!set) {
    set = new Set()
    uploadedBlobShaCache.set(key, set)
  }
  return set
}

/** Test hook. Drops the in-memory upload cache. */
export function _resetUploadedShaCache(): void {
  uploadedBlobShaCache.clear()
}

function toHostRepo(repo: GitHubRepo): HostRepo {
  return {
    owner: repo.owner.login,
    name: repo.name,
    defaultBranch: repo.default_branch,
    isPrivate: repo.private
  }
}

export class GitHubProvider implements GitHostProvider {
  readonly kind: HostKind = 'github'
  readonly baseUrl: string

  constructor(
    private readonly token: string,
    baseUrl: string = GITHUB_API_BASE
  ) {
    this.baseUrl = baseUrl
  }

  // --- repo ops ---
  async listRepos(): Promise<HostRepo[]> {
    const repos = await listUserRepos(this.token)
    return repos.map(toHostRepo)
  }

  async getRepo(owner: string, name: string): Promise<HostRepo> {
    const repo = await githubGetRepo(this.token, owner, name)
    return toHostRepo(repo)
  }

  async listBranches(owner: string, name: string): Promise<string[]> {
    const branches = await listRepoBranches(this.token, owner, name)
    return branches.map(b => b.name)
  }

  async createRepo(name: string, isPrivate: boolean): Promise<HostRepo> {
    const repo = await githubCreateRepo(this.token, name, isPrivate)
    return toHostRepo(repo)
  }

  async getAuthenticatedUser(): Promise<HostUser> {
    const u = await fetchGitHubUser(this.token)
    return { id: u.id, login: u.login, name: u.name, avatarUrl: u.avatar_url }
  }

  // --- git-data READ ---
  getBranchHeadSha(repo: SyncRepo): Promise<string> {
    return getBranchRefSha(this.token, repo.owner, repo.name, repo.branch)
  }

  getCommitTreeSha(repo: SyncRepo, commitSha: string): Promise<string> {
    return getCommitTreeSha(this.token, repo.owner, repo.name, commitSha)
  }

  getTreeMap(repo: SyncRepo, treeSha: string): Promise<Map<string, string>> {
    return getTreeMap(this.token, repo.owner, repo.name, treeSha)
  }

  getBlobContent(repo: SyncRepo, sha: string): Promise<string> {
    return getBlobContent(this.token, repo.owner, repo.name, sha)
  }

  getTreeMapCached(
    repo: SyncRepo,
    treeSha: string
  ): Promise<Map<string, string>> {
    return getTreeMapConditional(this.token, repo, treeSha)
  }

  getBlobContentCached(repo: SyncRepo, sha: string): Promise<string> {
    return getBlobContentConditional(this.token, repo, sha)
  }

  getBlobBytes(repo: SyncRepo, sha: string): Promise<Uint8Array> {
    return getBlobBytes(this.token, repo.owner, repo.name, sha)
  }

  // --- bulk archive (first-clone fast path) ---
  fetchArchive(repo: SyncRepo, ref: string): Promise<ArrayBuffer> {
    return fetchZipball(this.token, repo.owner, repo.name, ref)
  }

  // --- git-data WRITE ---
  // Reproduces the existing GitHub push: build a blob per create/update file
  // (binary via createBlobBinary when contentBytes is set), add a sha:null
  // tree entry per delete, then createTree(baseTree) → createCommit(parent) →
  // updateBranchRef. The base tree is the parent commit's tree.
  //
  // Two GitHub-blob optimizations carried over from the old inline syncPush
  // write block:
  //   1. Upload cache — a create/update whose content blob SHA is already in
  //      the per-repo cache (uploaded earlier this tab session, e.g. before a
  //      token-refresh retry) skips the blob POST and reuses the SHA as its
  //      tree entry. Reported as `skipped` in the progress stream.
  //   2. No-op-tree skip — if the assembled tree is byte-identical to the
  //      parent's tree (a freshly-cloned note that round-trips to the same
  //      bytes), creating a commit would produce an empty "No files changed"
  //      commit. We skip commit+ref and return `committed:false`.
  async commitChanges(
    repo: SyncRepo,
    req: CommitRequest
  ): Promise<CommitResult> {
    const { owner, name } = repo
    const { onProgress } = req
    const uploadedShas = getUploadedShas(repo)
    const baseTreeSha = await this.getCommitTreeSha(repo, req.parentSha)

    // Pre-pass: split create/update changes into "cached" (blob already on the
    // host, no POST) vs "to upload", so we can emit a stable `total`. Deletes
    // carry no blob. Content blob SHAs are computed locally and are identical
    // to what GitHub assigns (git content-addressing).
    interface BlobPlan {
      change: (typeof req.changes)[number]
      localSha: string
      cached: boolean
    }
    const blobPlans: BlobPlan[] = []
    for (const change of req.changes) {
      if (change.op === 'delete') continue
      const localSha = change.contentBytes
        ? await gitBlobShaBytes(change.contentBytes)
        : await gitBlobSha(change.content ?? '')
      blobPlans.push({ change, localSha, cached: uploadedShas.has(localSha) })
    }

    const total = blobPlans.filter(p => !p.cached).length
    const skipped = blobPlans.filter(p => p.cached).length
    let uploaded = 0
    const emit = () =>
      onProgress?.({ phase: 'uploading-blobs', uploaded, total, skipped })
    if (total > 0 || skipped > 0) emit()

    // Map every change to a tree entry, uploading blobs that aren't cached.
    const blobShaByChange = new Map<(typeof req.changes)[number], string>()
    const uploadedPaths: string[] = []
    for (const plan of blobPlans) {
      if (plan.cached) {
        blobShaByChange.set(plan.change, plan.localSha)
        continue
      }
      const blobSha = plan.change.contentBytes
        ? await createBlobBinary(
            this.token,
            owner,
            name,
            new Blob([plan.change.contentBytes.slice()])
          )
        : await createBlob(this.token, owner, name, plan.change.content ?? '')
      uploadedShas.add(plan.localSha)
      blobShaByChange.set(plan.change, blobSha)
      uploadedPaths.push(plan.change.path)
      uploaded++
      emit()
    }

    const entries: GitTreeEntry[] = req.changes.map(change =>
      change.op === 'delete'
        ? { path: change.path, mode: '100644', type: 'blob', sha: null }
        : {
            path: change.path,
            mode: '100644',
            type: 'blob',
            sha: blobShaByChange.get(change)!
          }
    )

    onProgress?.({ phase: 'building-tree' })
    const newTreeSha = await createTree(
      this.token,
      owner,
      name,
      baseTreeSha,
      entries
    )

    // No-op-tree skip: the changes resolved to the parent's exact tree, so a
    // commit would be empty. Leave the branch untouched and report no commit.
    if (newTreeSha === baseTreeSha) {
      uploadedShas.clear()
      return {
        commitSha: req.parentSha,
        commitUrl: null,
        committed: false,
        uploadedPaths
      }
    }

    onProgress?.({ phase: 'committing' })
    const { sha: commitSha, html_url } = await createCommit(
      this.token,
      owner,
      name,
      req.message,
      newTreeSha,
      req.parentSha
    )
    onProgress?.({ phase: 'updating-ref' })
    await updateBranchRef(this.token, owner, name, req.branch, commitSha)

    // Push succeeded — start the next push from a clean cache (the remote tree
    // is consulted again then).
    uploadedShas.clear()

    return { commitSha, commitUrl: html_url, committed: true, uploadedPaths }
  }
}
