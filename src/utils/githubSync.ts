import type { Note, Folder, SyncRepo } from '@/types'
import { sanitizeFilename } from './export'
import {
  getBranchRefSha,
  getCommitTreeSha,
  getTreeMap,
  createBlob,
  createTree,
  createCommit,
  updateBranchRef,
  gitBlobSha,
  type GitTreeEntry,
} from './github'

export interface SyncResult {
  unchanged: boolean
  created: number
  updated: number
  deleted: number
  commitSha: string
  commitUrl: string | null
}

// ── Path computation ────────────────────────────────────────────────────────
// Mirrors the local folder hierarchy. Notes with folderId=null go at the
// repo root. The .md filename is derived from the note title.

function buildFolderPath(folderId: string | null, folders: Folder[]): string {
  if (!folderId) return ''
  const byId = new Map(folders.map(f => [f.id, f]))
  const segs: string[] = []
  let cur: Folder | undefined = byId.get(folderId)
  // Walk up to root; guard against cycles with a depth cap.
  for (let i = 0; cur && i < 32; i++) {
    if (cur.isDeleted) break
    segs.unshift(sanitizeFilename(cur.name))
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return segs.join('/')
}

export function notePath(note: Note, folders: Folder[]): string {
  const dir = buildFolderPath(note.folderId, folders)
  const file = `${sanitizeFilename(note.title || 'Untitled')}.md`
  return dir ? `${dir}/${file}` : file
}

// ── Note serialization ──────────────────────────────────────────────────────
// Obsidian convention: a .md file is just the body, with an optional YAML
// frontmatter block at the top *only* when there's something to put in it.
// Today the only field we round-trip is `tags`. No id/title/dates — the
// filename is the title and round-tripping (Phase 4 pull) matches by path.

function yamlList(items: string[]): string {
  return `[${items.map(s => (/^[A-Za-z0-9_-]+$/.test(s) ? s : JSON.stringify(s))).join(', ')}]`
}

export function serializeNote(note: Note, tagNamesById: Map<string, string>): string {
  const tagNames = note.tags
    .map(id => tagNamesById.get(id))
    .filter((n): n is string => !!n)
  const body = note.content ?? ''
  if (tagNames.length === 0) return body
  return `---\ntags: ${yamlList(tagNames)}\n---\n\n${body}`
}

// ── Sync orchestrator ───────────────────────────────────────────────────────

export interface SyncInput {
  token: string
  repo: SyncRepo
  notes: Note[]
  folders: Folder[]
  tags: { id: string; name: string }[]
}

export type GitPathUpdate = { noteId: string; gitPath: string | null }

export interface SyncOutcome {
  result: SyncResult
  // The caller applies these updates to the note store so each note remembers
  // where it lives in the repo (and which ones are no longer there).
  pathUpdates: GitPathUpdate[]
}

export async function syncToGitHub(input: SyncInput): Promise<SyncOutcome> {
  const { token, repo, notes, folders, tags } = input
  const { owner, name, branch } = repo

  // 1. Compute desired files for every active note.
  const tagMap = new Map(tags.map(t => [t.id, t.name]))
  const activeNotes = notes.filter(n => !n.isDeleted)
  const desired = new Map<string, { content: string; note: Note }>()
  for (const note of activeNotes) {
    const path = notePath(note, folders)
    const content = serializeNote(note, tagMap)
    // If two notes resolve to the same path (e.g. duplicate titles in same
    // folder), the later one in the array wins. Acceptable for v1.
    desired.set(path, { content, note })
  }

  // 2. Fetch the current branch state.
  const parentCommitSha = await getBranchRefSha(token, owner, name, branch)
  const baseTreeSha = await getCommitTreeSha(token, owner, name, parentCommitSha)
  const remoteTree = await getTreeMap(token, owner, name, baseTreeSha)

  // 3. Build tree entries for changes only.
  const entries: GitTreeEntry[] = []
  const pathUpdates: GitPathUpdate[] = []
  let created = 0
  let updated = 0
  let deleted = 0

  for (const [path, { content, note }] of desired) {
    const localSha = await gitBlobSha(content)
    const remoteSha = remoteTree.get(path)
    if (remoteSha !== localSha) {
      // Need to upload a blob for the new content.
      const blobSha = await createBlob(token, owner, name, content)
      entries.push({ path, mode: '100644', type: 'blob', sha: blobSha })
      if (remoteSha) updated++; else created++
    }
    // Record the path on the note regardless (first-time pushes need this
    // even when the blob happened to match an already-existing remote file).
    if (note.gitPath !== path) pathUpdates.push({ noteId: note.id, gitPath: path })
  }

  // 4. Handle deletions: notes that USED to have a gitPath but no longer
  // resolve there (rename or moved folder) and notes that are now in trash.
  const desiredPaths = new Set(desired.keys())
  const seenGitPaths = new Set<string>()
  for (const note of activeNotes) {
    if (note.gitPath) seenGitPaths.add(note.gitPath)
    if (note.gitPath && !desiredPaths.has(note.gitPath) && remoteTree.has(note.gitPath)) {
      entries.push({ path: note.gitPath, mode: '100644', type: 'blob', sha: null })
      deleted++
    }
  }
  for (const note of notes) {
    if (note.isDeleted && note.gitPath && remoteTree.has(note.gitPath)) {
      // Only delete if no active note has already moved into that path.
      if (!desired.has(note.gitPath) && !seenGitPaths.has(note.gitPath)) {
        entries.push({ path: note.gitPath, mode: '100644', type: 'blob', sha: null })
        deleted++
      }
      pathUpdates.push({ noteId: note.id, gitPath: null })
    }
  }

  if (entries.length === 0) {
    return {
      result: { unchanged: true, created: 0, updated: 0, deleted: 0, commitSha: parentCommitSha, commitUrl: null },
      pathUpdates,
    }
  }

  // 5. Create new tree → commit → fast-forward branch.
  const newTreeSha = await createTree(token, owner, name, baseTreeSha, entries)
  const total = created + updated + deleted
  const message = `Sync from Noteser (${total} change${total === 1 ? '' : 's'})`
  const { sha: commitSha, html_url } = await createCommit(token, owner, name, message, newTreeSha, parentCommitSha)
  await updateBranchRef(token, owner, name, branch, commitSha)

  return {
    result: { unchanged: false, created, updated, deleted, commitSha, commitUrl: html_url },
    pathUpdates,
  }
}
