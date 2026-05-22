// In-browser git operations layered on top of isomorphic-git +
// the FSA filesystem adapter (`fsaFs.ts`).
//
// Scope:
//   - `git init` on the picked folder
//   - Read/set the `origin` remote URL
//   - `git add` all .md files (tracked + new)
//   - `git commit` with the user's GitHub identity
//   - `git push` to origin
//
// GitHub's git endpoints don't ship CORS headers, so push requires a
// CORS-friendly proxy. We use Next.js's `/api/git-proxy/[...path]`
// route (see `src/app/api/git-proxy/[...path]/route.ts`) which
// forwards Smart HTTP requests to github.com.
//
// Auth: isomorphic-git's `onAuth` hook is called when pushing to a
// host that needs credentials. We return the GitHub OAuth token as
// the password and `x-access-token` as the username (GitHub's
// recommended pattern for HTTPS pushes).

import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import { createFsaFs } from './fsaFs'

// The proxy origin. Runtime-resolved so the same code works in dev
// (localhost:3001), prod (noteser.thetechjon.com), and per-branch
// previews. The `/api/git-proxy` route handles every git Smart HTTP
// sub-path under it.
function corsProxy(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api/git-proxy`
}

export interface GitAuthor {
  name: string
  email: string
}

export interface InitOptions {
  root: FileSystemDirectoryHandle
  defaultBranch?: string
}

export async function initRepo(opts: InitOptions): Promise<void> {
  const fs = createFsaFs(opts.root)
  await git.init({
    fs,
    dir: '/',
    defaultBranch: opts.defaultBranch ?? 'main',
  })
}

export async function isRepo(root: FileSystemDirectoryHandle): Promise<boolean> {
  const fs = createFsaFs(root)
  try {
    // resolveRef('HEAD') succeeds iff there's a valid git directory.
    await git.resolveRef({ fs, dir: '/', ref: 'HEAD' })
    return true
  } catch {
    // Fall back to a cheap check — does `.git/HEAD` exist?
    try {
      await fs.promises.stat('/.git/HEAD')
      return true
    } catch {
      return false
    }
  }
}

export async function getRemoteUrl(root: FileSystemDirectoryHandle): Promise<string | null> {
  const fs = createFsaFs(root)
  try {
    const url = await git.getConfig({ fs, dir: '/', path: 'remote.origin.url' })
    return url ?? null
  } catch {
    return null
  }
}

export async function setRemoteUrl(root: FileSystemDirectoryHandle, url: string): Promise<void> {
  const fs = createFsaFs(root)
  await git.setConfig({ fs, dir: '/', path: 'remote.origin.url', value: url })
}

export interface StageOptions {
  root: FileSystemDirectoryHandle
  // Per file, returns the relative path the file lives at in the repo.
  // We default to staging only .md and .json files at the root + any
  // depth (so .noteser/ settings + the notes themselves are caught
  // but .git/ and binary attachments are skipped — those are tracked
  // separately or ignored).
  patterns?: RegExp[]
}

const DEFAULT_PATTERNS = [/\.md$/i, /\/\.noteser\/.+\.json$/i, /^\.noteser\/.+\.json$/i, /^README/i]

// Walk the folder, stage every file that matches a pattern. Equivalent
// to `git add <files>` but does NOT remove deleted files from the
// index (isomorphic-git's `add` is additive only). For the noteser
// model where the local folder = the vault, a follow-up `git rm` for
// missing files would be needed to make `commit` reflect deletions —
// out of scope for v1.
export async function stageAll(opts: StageOptions): Promise<string[]> {
  const fs = createFsaFs(opts.root)
  const patterns = opts.patterns ?? DEFAULT_PATTERNS
  const staged: string[] = []

  async function walk(dirHandle: FileSystemDirectoryHandle, prefix: string) {
    const entries = (dirHandle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()
    for await (const entry of entries) {
      if (entry.name === '.git' || entry.name.startsWith('.git')) continue
      const sub = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        await walk(entry as FileSystemDirectoryHandle, sub)
      } else if (entry.kind === 'file') {
        if (patterns.some(re => re.test(sub))) {
          await git.add({ fs, dir: '/', filepath: sub })
          staged.push(sub)
        }
      }
    }
  }
  await walk(opts.root, '')
  return staged
}

export interface CommitOptions {
  root: FileSystemDirectoryHandle
  message: string
  author: GitAuthor
}

export async function commit(opts: CommitOptions): Promise<string> {
  const fs = createFsaFs(opts.root)
  return git.commit({
    fs,
    dir: '/',
    author: opts.author,
    message: opts.message,
  })
}

export interface PushOptions {
  root: FileSystemDirectoryHandle
  token: string
  // Branch name. Defaults to the local HEAD's current branch (typically `main`).
  ref?: string
  // Optional progress callback (isomorphic-git emits {phase, loaded, total}).
  onProgress?: (event: { phase: string; loaded: number; total: number }) => void
}

export async function push(opts: PushOptions): Promise<void> {
  const fs = createFsaFs(opts.root)
  const ref = opts.ref ?? await git.currentBranch({ fs, dir: '/', fullname: false }) ?? 'main'
  await git.push({
    fs,
    http,
    dir: '/',
    remote: 'origin',
    ref,
    corsProxy: corsProxy(),
    onAuth: () => ({
      username: 'x-access-token',
      password: opts.token,
    }),
    onProgress: opts.onProgress,
  })
}

export interface StatusSummary {
  // Files whose working-tree content differs from what's staged.
  modified: string[]
  // Files in the working tree but absent from the index.
  untracked: string[]
  // Files in the index that no longer exist in the working tree.
  deleted: string[]
}

// Cheap status report — calls statusMatrix on the standard patterns.
// Useful for "what would commit?" previews in the UI.
export async function summarizeStatus(root: FileSystemDirectoryHandle): Promise<StatusSummary> {
  const fs = createFsaFs(root)
  const rows = await git.statusMatrix({ fs, dir: '/', filter: f => DEFAULT_PATTERNS.some(re => re.test(f)) })
  const modified: string[] = []
  const untracked: string[] = []
  const deleted: string[] = []
  for (const [filepath, head, workdir, stage] of rows) {
    // [HEAD, WORKDIR, STAGE] columns: 0 = absent, 1 = same as HEAD, 2 = different from HEAD.
    // Patterns reference: https://isomorphic-git.org/docs/en/statusMatrix
    if (head === 0 && workdir === 2 && stage === 0) untracked.push(filepath)
    else if (head === 1 && workdir === 2) modified.push(filepath)
    else if (head === 1 && workdir === 0) deleted.push(filepath)
  }
  return { modified, untracked, deleted }
}
