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
  getBlobContent,
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
// We write the body verbatim — no YAML frontmatter. Tags now live as `#word`
// patterns inline in the body, so there's nothing to round-trip in a header.
// Round-trip identity uses the file path (Phase 4 pull matches by gitPath).
//
export function serializeNote(note: Note): string {
  return note.content ?? ''
}

// ── Parser (Phase 4 pull) ───────────────────────────────────────────────────
// We only support the YAML subset we ourselves emit: `tags: [a, "b", c]` on a
// single line. Anything else in the frontmatter is preserved into the body so
// we don't silently destroy custom user metadata.
export interface ParsedNote {
  tags: string[]
  body: string
}

export function parseNote(raw: string): ParsedNote {
  // No frontmatter — everything is body.
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { tags: [], body: raw }
  }
  // Find the closing delimiter starting at line 1.
  const endMatch = raw.match(/\n---\r?\n/)
  if (!endMatch || endMatch.index === undefined) return { tags: [], body: raw }

  const fmBlock = raw.slice(4, endMatch.index)
  const bodyStart = endMatch.index + endMatch[0].length
  const body = raw.slice(bodyStart)

  // Pull the tags line if present. Accept both inline `[a, b]` and our quoted
  // variant `["a", "b"]`. Unknown fields fall through to body untouched.
  const tagsLineMatch = fmBlock.match(/^tags:\s*\[(.*)\]\s*$/m)
  const tags: string[] = []
  if (tagsLineMatch) {
    const inner = tagsLineMatch[1].trim()
    if (inner) {
      // Split on commas not inside quotes. Simple state-machine; good enough
      // for the format we produce.
      let cur = ''
      let inQuote = false
      for (let i = 0; i < inner.length; i++) {
        const c = inner[i]
        if (c === '"') { inQuote = !inQuote; continue }
        if (c === ',' && !inQuote) {
          const t = cur.trim()
          if (t) tags.push(t)
          cur = ''
          continue
        }
        cur += c
      }
      const t = cur.trim()
      if (t) tags.push(t)
    }
  }
  return { tags, body }
}

// ── Pull (Phase 4) ──────────────────────────────────────────────────────────

export type PullClassification =
  // Local & remote agree, nothing to do.
  | { kind: 'unchanged'; noteId: string }
  // Remote has a file with no matching local note yet — create one.
  | { kind: 'remoteCreated'; path: string; remoteSha: string; remoteContent: string; tags: string[]; body: string }
  // Local exists, remote changed since our last push, local has NOT changed
  // since last sync — accept the remote version.
  | { kind: 'remoteUpdated'; noteId: string; remoteSha: string; remoteContent: string; tags: string[]; body: string }
  // We previously pushed this note, but the file is gone from the repo and
  // we haven't edited it locally since — soft-delete it locally.
  | { kind: 'remoteDeleted'; noteId: string }
  // Both sides changed — let the user pick.
  | {
      kind: 'conflict'
      noteId: string
      path: string
      localContent: string
      remoteSha: string
      remoteContent: string
      remoteTags: string[]
      remoteBody: string
    }
  // Remote deleted the file but we edited it locally — degenerate conflict
  // that's still asking the user a question, treat it as a conflict variant.
  | {
      kind: 'conflictDeleted'
      noteId: string
      path: string
      localContent: string
    }

export interface PullOutcome {
  classifications: PullClassification[]
  latestCommitSha: string
}

export async function pullFromGitHub(input: {
  token: string
  repo: SyncRepo
  notes: Note[]
  folders: Folder[]
}): Promise<PullOutcome> {
  const { token, repo, notes } = input
  const { owner, name, branch } = repo

  const headSha = await getBranchRefSha(token, owner, name, branch)
  const treeSha = await getCommitTreeSha(token, owner, name, headSha)
  const remoteTree = await getTreeMap(token, owner, name, treeSha)

  const out: PullClassification[] = []
  const seenLocalIds = new Set<string>()

  // 1. Walk every remote .md file.
  for (const [path, remoteSha] of remoteTree) {
    if (!path.endsWith('.md')) continue
    const localMatch = notes.find(n => !n.isDeleted && n.gitPath === path)

    // Fetch the remote content lazily — only when we need it.
    let remoteContent: string | null = null
    const loadRemote = async () => {
      if (remoteContent === null) remoteContent = await getBlobContent(token, owner, name, remoteSha)
      return remoteContent
    }

    if (!localMatch) {
      const content = await loadRemote()
      const parsed = parseNote(content)
      out.push({ kind: 'remoteCreated', path, remoteSha, remoteContent: content, tags: parsed.tags, body: parsed.body })
      continue
    }

    seenLocalIds.add(localMatch.id)
    const localContent = serializeNote(localMatch)
    const localBlobSha = await gitBlobSha(localContent)

    if (localBlobSha === remoteSha) {
      out.push({ kind: 'unchanged', noteId: localMatch.id })
      continue
    }

    const lastPushed = localMatch.gitLastPushedSha ?? null
    const remoteChanged = lastPushed !== remoteSha
    const localChanged = lastPushed !== localBlobSha

    if (remoteChanged && !localChanged) {
      const content = await loadRemote()
      const parsed = parseNote(content)
      out.push({ kind: 'remoteUpdated', noteId: localMatch.id, remoteSha, remoteContent: content, tags: parsed.tags, body: parsed.body })
    } else if (remoteChanged && localChanged) {
      const content = await loadRemote()
      const parsed = parseNote(content)
      out.push({
        kind: 'conflict',
        noteId: localMatch.id,
        path,
        localContent,
        remoteSha,
        remoteContent: content,
        remoteTags: parsed.tags,
        remoteBody: parsed.body,
      })
    }
    // remoteUnchanged + localChanged → handled by the push phase, nothing here.
  }

  // 2. Local notes that had a gitPath but are missing from the remote tree.
  for (const note of notes) {
    if (note.isDeleted || !note.gitPath || seenLocalIds.has(note.id)) continue
    if (remoteTree.has(note.gitPath)) continue
    // Was it deleted on the remote?
    const lastPushed = note.gitLastPushedSha ?? null
    const localContent = serializeNote(note)
    const localBlobSha = await gitBlobSha(localContent)
    if (lastPushed && lastPushed === localBlobSha) {
      // We haven't touched it locally since the last push → accept the delete.
      out.push({ kind: 'remoteDeleted', noteId: note.id })
    } else if (lastPushed) {
      // Remote deleted, local has edits since the last sync → conflict.
      out.push({ kind: 'conflictDeleted', noteId: note.id, path: note.gitPath, localContent })
    }
    // No lastPushed → this note was never actually synced (clear stale gitPath
    // and let push re-create it). Treat as remoteDeleted to just clear state.
    else {
      out.push({ kind: 'remoteDeleted', noteId: note.id })
    }
  }

  return { classifications: out, latestCommitSha: headSha }
}

// ── Sync orchestrator ───────────────────────────────────────────────────────

export interface SyncInput {
  token: string
  repo: SyncRepo
  notes: Note[]
  folders: Folder[]
}

export type GitPathUpdate = {
  noteId: string
  gitPath: string | null
  // Blob SHA of what we just pushed for this note. Null when the note's file
  // was deleted in this commit.
  gitLastPushedSha: string | null
}

export interface SyncOutcome {
  result: SyncResult
  // The caller applies these updates to the note store so each note remembers
  // where it lives in the repo (and which ones are no longer there).
  pathUpdates: GitPathUpdate[]
}

export async function syncToGitHub(input: SyncInput): Promise<SyncOutcome> {
  const { token, repo, notes, folders } = input
  const { owner, name, branch } = repo

  // 1. Compute desired files for every active note.
  const activeNotes = notes.filter(n => !n.isDeleted)
  const desired = new Map<string, { content: string; note: Note }>()
  for (const note of activeNotes) {
    const path = notePath(note, folders)
    const content = serializeNote(note)
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
    let finalSha = remoteSha ?? null
    if (remoteSha !== localSha) {
      // Need to upload a blob for the new content.
      finalSha = await createBlob(token, owner, name, content)
      entries.push({ path, mode: '100644', type: 'blob', sha: finalSha })
      if (remoteSha) updated++; else created++
    }
    // Record the path + last-pushed SHA on the note. We always update this so
    // first-time pushes (and content-equal-but-path-changed) write the field.
    if (note.gitPath !== path || note.gitLastPushedSha !== finalSha) {
      pathUpdates.push({ noteId: note.id, gitPath: path, gitLastPushedSha: finalSha ?? localSha })
    }
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
      pathUpdates.push({ noteId: note.id, gitPath: null, gitLastPushedSha: null })
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
