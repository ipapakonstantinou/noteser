// The host-abstraction seam for vault sync. See
// docs/multi-host-sync-plan.md → "The seam: GitHostProvider".
//
// The whole point: the GitHub push flow (createBlob → createTree →
// createCommit → updateBranchRef) cannot be ported to Forgejo/Gitea because
// those create endpoints don't exist there. So the seam does NOT expose
// git-data write primitives — it exposes a higher-level "commit a batch of
// file changes" operation each host implements its own way.

import type { SyncRepo, GitHubUser } from '@/types'

export type HostKind = 'github' | 'forgejo'

export interface HostUser {
  id: string | number
  login: string
  name: string | null
  avatarUrl?: string
}

export interface HostRepo {
  owner: string
  name: string
  defaultBranch: string
  isPrivate: boolean
}

/** One file change in a commit. content is the raw UTF-8 string (provider
 *  handles base64). For deletes, content is omitted. sha is the *current*
 *  blob sha of the file being replaced/deleted (Forgejo requires it;
 *  GitHub ignores it). */
export interface FileChange {
  op: 'create' | 'update' | 'delete'
  path: string
  content?: string
  contentBytes?: Uint8Array // for binary attachments
  sha?: string
}

// Host-agnostic progress for a single commitChanges call. A multi-request
// host (GitHub: N blobs + tree + commit + ref) reports each phase; a
// single-request host (Forgejo ChangeFiles) may only report `committing`.
// `uploading-blobs` carries running counts so the caller can render
// "uploaded 47 / 200 (3 skipped)". The caller translates these back into
// whatever external progress shape it exposes.
export type CommitProgress =
  | {
      phase: 'uploading-blobs'
      uploaded: number
      total: number
      skipped: number
    }
  | { phase: 'building-tree' }
  | { phase: 'committing' }
  | { phase: 'updating-ref' }

export interface CommitRequest {
  branch: string
  parentSha: string // expected current head (optimistic FF)
  message: string
  changes: FileChange[]
  // Optional host-agnostic progress hook. Hosts emit the phases they
  // actually perform; absent phases simply aren't reported.
  onProgress?: (event: CommitProgress) => void
}

export interface CommitResult {
  commitSha: string
  commitUrl: string | null
  // False when the host determined the change set was a no-op (e.g. the
  // built tree was byte-identical to the parent's tree, so no commit was
  // created and the branch was left untouched). commitSha then equals the
  // parent sha. True when a real commit advanced the branch.
  committed: boolean
  // Paths whose create/update content was actually transmitted to the host
  // (as opposed to satisfied from a same-session content cache). On GitHub a
  // path is absent here when its blob was already uploaded earlier this tab
  // session (a token-refresh retry) and reused. Hosts with no content cache
  // list every create/update path. The caller uses this to mirror the prior
  // syncPush behavior of only recording a path-metadata update for paths it
  // genuinely pushed in this attempt.
  uploadedPaths: string[]
}

export interface GitHostProvider {
  readonly kind: HostKind
  readonly baseUrl: string // e.g. https://api.github.com | https://codeberg.org

  // --- repo ops ---
  listRepos(): Promise<HostRepo[]>
  getRepo(owner: string, name: string): Promise<HostRepo>
  listBranches(owner: string, name: string): Promise<string[]>
  createRepo(name: string, isPrivate: boolean): Promise<HostRepo>

  // --- git-data READ (near-identical across hosts) ---
  getBranchHeadSha(repo: SyncRepo): Promise<string>
  getCommitTreeSha(repo: SyncRepo, commitSha: string): Promise<string>
  getTreeMap(repo: SyncRepo, treeSha: string): Promise<Map<string, string>> // path -> blobSha
  getBlobContent(repo: SyncRepo, sha: string): Promise<string>
  getBlobBytes(repo: SyncRepo, sha: string): Promise<Uint8Array>

  // Cached read variants for the PULL path: same result as getTreeMap /
  // getBlobContent, but a host may layer caching on top (GitHub uses #69
  // ETag-conditional requests). The PUSH path must use the plain reads above
  // — a stale tree would risk a non-fast-forward commit — so only pull uses
  // these. Hosts without a caching layer (Forgejo) alias them to plain reads.
  getTreeMapCached(
    repo: SyncRepo,
    treeSha: string
  ): Promise<Map<string, string>>
  getBlobContentCached(repo: SyncRepo, sha: string): Promise<string>

  // --- bulk archive (first-clone fast path) ---
  // Optional whole-repo archive download for the first-clone fast path
  // (GitHub: zipball; Forgejo: GET /archive/{ref}.zip, or omit). Returns the
  // raw archive bytes; the caller unzips. Hosts without an archive endpoint
  // leave this undefined and the caller falls back to the per-blob pull.
  fetchArchive?(repo: SyncRepo, ref: string): Promise<ArrayBuffer>

  // The authenticated user behind the token. Used by the connect flow to
  // populate the session identity host-agnostically.
  getAuthenticatedUser(): Promise<HostUser>

  // --- git-data WRITE (the one real divergence) ---
  commitChanges(repo: SyncRepo, req: CommitRequest): Promise<CommitResult>
}

// Bridge the host-agnostic HostUser onto the store's existing GitHubUser shape
// (avatarUrl -> avatar_url, id coerced to number). Lets the store keep its
// current type while the connect flow stays host-agnostic.
export function hostUserToGitHubUser(u: HostUser): GitHubUser {
  return {
    id: typeof u.id === 'number' ? u.id : Number(u.id) || 0,
    login: u.login,
    name: u.name,
    avatar_url: u.avatarUrl ?? ''
  }
}
