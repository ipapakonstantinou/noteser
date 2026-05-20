import JSZip from 'jszip'
import type { Note, Folder, SyncRepo } from '@/types'
import { sanitizeFilename } from './export'
import {
  getBranchRefSha,
  getCommitTreeSha,
  getTreeMap,
  createBlob,
  createBlobBinary,
  createTree,
  createCommit,
  updateBranchRef,
  getBlobContent,
  getBlobBytes,
  gitBlobSha,
  gitBlobShaBytes,
  fetchZipball,
  type GitTreeEntry,
} from './github'
import { threeWayMerge } from './lineDiff'
import {
  isAttachmentPath,
  listAttachmentPaths,
  getAttachmentBlob,
  getAttachmentGitSha,
  getAttachmentTombstones,
  clearAttachmentTombstones,
} from './attachments'

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

// Repo-paths (e.g. `.obsidian/themes`) for every non-deleted local folder.
// Used by the pull's directory-walking pass to skip dirs we already
// materialised — without it we'd emit duplicate folderCreated entries on
// every sync.
function collectLocalFolderRepoPaths(folders: Folder[]): Set<string> {
  const out = new Set<string>()
  for (const f of folders) {
    if (f.isDeleted) continue
    const p = buildFolderPath(f.id, folders)
    if (p) out.add(p)
  }
  return out
}

export function notePath(note: Note, folders: Folder[]): string {
  const dir = buildFolderPath(note.folderId, folders)
  const file = `${sanitizeFilename(note.title || 'Untitled')}.md`
  return dir ? `${dir}/${file}` : file
}

// Map common image extensions to MIME types so attachment pulls hand the
// apply layer a properly-typed Blob. Unknown extensions fall back to
// `application/octet-stream` — the file still round-trips, just without a
// recognised type for browser previews.
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

export function guessMimeFromPath(path: string): string {
  const dotIdx = path.lastIndexOf('.')
  if (dotIdx === -1) return 'application/octet-stream'
  const ext = path.slice(dotIdx + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

// ── Note serialization ──────────────────────────────────────────────────────
// We write the body verbatim — no YAML frontmatter. Tags now live as `#word`
// patterns inline in the body, so there's nothing to round-trip in a header.
// Round-trip identity uses the file path (Phase 4 pull matches by gitPath).
//
// IMPORTANT: we normalise to LF line endings + a single trailing newline so
// our blob SHA matches what Obsidian (and most editors that follow the POSIX
// "text files end in \n" convention) write for the same logical content. Without
// this, every Obsidian-side save would re-touch the file and noteser would see
// the trailing-newline difference as drift, re-uploading every blob on each
// sync (the storm bug). See `normalizeForPush` for the canonical form.
export function serializeNote(note: Note): string {
  return normalizeForPush(note.content ?? '')
}

// Canonical wire form: CRLF → LF, ensure exactly one trailing \n, drop a
// completely empty file's "newline" (an empty file is just empty bytes —
// adding "\n" would create drift the other way).
export function normalizeForPush(content: string): string {
  if (content === '') return ''
  const lf = content.replace(/\r\n/g, '\n')
  return lf.endsWith('\n') ? lf : `${lf}\n`
}

// ── Parser (Phase 4 pull) ───────────────────────────────────────────────────
// We only support the YAML subset we ourselves emit / commonly see in
// Obsidian vaults: `tags: [a, "b", c]` or `aliases: [Short, "Even Shorter"]`
// on a single line. Anything else in the frontmatter is preserved into the
// body so we don't silently destroy custom user metadata.
export interface ParsedNote {
  tags: string[]
  aliases: string[]
  body: string
}

// Parse a single-line YAML inline-array field (e.g. `tags: [a, "b", c]`) out
// of the given frontmatter block. Returns [] when the field is absent or the
// list is empty. Splits on commas, but ignores commas inside double quotes —
// good enough for the formats we produce or encounter in real Obsidian vaults.
function parseInlineArrayField(fmBlock: string, fieldName: string): string[] {
  const re = new RegExp(`^${fieldName}:\\s*\\[(.*)\\]\\s*$`, 'm')
  const lineMatch = fmBlock.match(re)
  if (!lineMatch) return []
  const inner = lineMatch[1].trim()
  if (!inner) return []
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '"') { inQuote = !inQuote; continue }
    if (c === ',' && !inQuote) {
      const t = cur.trim()
      if (t) out.push(t)
      cur = ''
      continue
    }
    cur += c
  }
  const t = cur.trim()
  if (t) out.push(t)
  return out
}

export function parseNote(raw: string): ParsedNote {
  // No frontmatter — everything is body.
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { tags: [], aliases: [], body: raw }
  }
  // Find the closing delimiter starting at line 1.
  const endMatch = raw.match(/\n---\r?\n/)
  if (!endMatch || endMatch.index === undefined) return { tags: [], aliases: [], body: raw }

  const fmBlock = raw.slice(4, endMatch.index)
  const bodyStart = endMatch.index + endMatch[0].length
  const body = raw.slice(bodyStart)

  const tags = parseInlineArrayField(fmBlock, 'tags')
  const aliases = parseInlineArrayField(fmBlock, 'aliases')
  return { tags, aliases, body }
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
  // Both sides changed but the line-level edits don't overlap, so we 3-way
  // merged automatically. Apply writes the merged content + pins
  // gitLastPushedSha to remoteSha so the next push uploads the union edit.
  | {
      kind: 'autoMerged'
      noteId: string
      remoteSha: string
      mergedContent: string
    }
  // Remote deleted the file but we edited it locally — degenerate conflict
  // that's still asking the user a question, treat it as a conflict variant.
  | {
      kind: 'conflictDeleted'
      noteId: string
      path: string
      localContent: string
    }
  // Binary attachment: remote has this file, local doesn't. Apply step fetches
  // the bytes and writes them to IDB at the same path.
  | { kind: 'attachmentCreated'; path: string; remoteSha: string; mime: string }
  // Binary attachment: local + remote both have it but content differs. We
  // treat remote as authoritative for v1 (no per-attachment three-way merge).
  | { kind: 'attachmentUpdated'; path: string; remoteSha: string; mime: string }
  // Directory the remote tree implies (via any file inside it) that we don't
  // have locally. Materialise it as an empty Folder so the sidebar reflects
  // the repo's structure — surfaces `.obsidian/` and similar dotfile dirs.
  | { kind: 'folderCreated'; path: string }

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
    // Look up by gitPath in ALL notes (incl. soft-deleted). A
    // soft-deleted note at the same path means the user explicitly
    // wants this gone — we MUST NOT treat the remote file as a new
    // creation and resurrect it. Push step 4 will emit the
    // `sha: null` tree entry to actually delete it.
    const localMatch = notes.find(n => n.gitPath === path)

    if (localMatch && localMatch.isDeleted) {
      // Pending deletion — skip the fetch + classification entirely.
      // seenLocalIds includes it so the orphan-detection branch below
      // doesn't double-count.
      seenLocalIds.add(localMatch.id)
      out.push({ kind: 'unchanged', noteId: localMatch.id })
      continue
    }

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

      // Try a line-level 3-way merge before bothering the user. If the local
      // and remote edits don't overlap line-wise we can auto-merge and the
      // user never sees the conflict tab. We need the common ancestor blob —
      // which is exactly what `gitLastPushedSha` points at. Anything that goes
      // wrong (no ancestor sha, blob GC'd, network hiccup, overlapping edits)
      // falls back to the existing manual conflict flow.
      let autoMerged: string | null = null
      if (lastPushed) {
        try {
          const ancestor = await getBlobContent(token, owner, name, lastPushed)
          const merged = threeWayMerge(ancestor, localContent, content)
          if (merged.ok) autoMerged = merged.merged
        } catch {
          // Swallow — fall through to conflict.
        }
      }

      if (autoMerged !== null) {
        out.push({
          kind: 'autoMerged',
          noteId: localMatch.id,
          remoteSha,
          mergedContent: autoMerged,
        })
      } else {
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
    }
    // remoteUnchanged + localChanged → handled by the push phase, nothing here.
  }

  // 1b. Empty / non-syncable directories the remote implies. We classify
  // every parent directory of every blob; the apply step calls
  // ensureFolderPath on each, so dotfile dirs like `.obsidian/` and
  // `.obsidian/themes/` show in the sidebar even though we don't pull their
  // file contents. The `attachments/` tree is excluded — it stays rendered
  // by the sidebar's synthetic folder, not as a real Folder entity.
  const localFolderPaths = collectLocalFolderRepoPaths(input.folders)
  const seenDirPaths = new Set<string>()
  for (const [path] of remoteTree) {
    let cur = path
    while (true) {
      const lastSlash = cur.lastIndexOf('/')
      if (lastSlash === -1) break
      cur = cur.slice(0, lastSlash)
      if (!cur) break
      if (seenDirPaths.has(cur)) break
      seenDirPaths.add(cur)
      if (localFolderPaths.has(cur)) continue
      out.push({ kind: 'folderCreated', path: cur })
    }
  }

  // 1c. Binary attachments under `attachments/`. Compare each remote entry
  // against the local IDB store; queue creates/updates so syncApply can fetch
  // the bytes lazily (each blob fetch is its own API call, so we only pay
  // for ones the user actually needs).
  const localAttachmentPaths = new Set(await listAttachmentPaths())
  for (const [path, remoteSha] of remoteTree) {
    if (!isAttachmentPath(path)) continue
    // Best-effort MIME guess from extension — the apply step uses this to
    // build the Blob. Falls back to octet-stream.
    const mime = guessMimeFromPath(path)
    if (!localAttachmentPaths.has(path)) {
      out.push({ kind: 'attachmentCreated', path, remoteSha, mime })
      continue
    }
    const localSha = await getAttachmentGitSha(path)
    if (localSha && localSha !== remoteSha) {
      out.push({ kind: 'attachmentUpdated', path, remoteSha, mime })
    }
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

// ── Bulk first-clone (zipball fast path) ────────────────────────────────────
//
// `pullFromGitHub` is correct but does one blob fetch per file that differs
// from local. On a first connection to a large vault (thousands of files) we
// already know everything is `remoteCreated`, so the per-file API trip is
// pure waste — we'd burn rate limit and minutes of wall time. The zipball
// endpoint hands us the whole repo as a single zip download, which the
// browser already follows past a redirect on its own and which doesn't get
// charged against the primary API rate limit the way blob reads do.
//
// We still need authoritative blob SHAs to seed `gitLastPushedSha`. Computing
// them locally via `gitBlobSha` produces the same hash git would (it's the
// same SHA-1 of `blob <len>\0<content>`), so a separate tree fetch isn't
// necessary.
export async function pullFromZipball(input: {
  token: string
  repo: SyncRepo
}): Promise<PullOutcome> {
  const { token, repo } = input
  const { owner, name, branch } = repo

  // Fetch the ref + the zipball in parallel; the ref is cheap and we need
  // it for `latestCommitSha` regardless.
  const [headSha, zipBuffer] = await Promise.all([
    getBranchRefSha(token, owner, name, branch),
    fetchZipball(token, owner, name, branch),
  ])

  const zip = await JSZip.loadAsync(zipBuffer)
  const classifications: PullClassification[] = []

  // The zipball wraps every entry in a top-level directory named
  // `<owner>-<repo>-<short-sha>/`, so we strip the first path segment.
  const entries: Array<{ rel: string; file: JSZip.JSZipObject }> = []
  zip.forEach((rel, file) => {
    if (file.dir) return
    // Pull both .md notes and binary files under the attachments folder
    // (configured or historical default). Anything else in the repo (root
    // README, .github/, etc.) is ignored on the first clone.
    if (rel.endsWith('.md')) {
      entries.push({ rel, file })
      return
    }
    const slashIdx = rel.indexOf('/')
    if (slashIdx !== -1 && isAttachmentPath(rel.slice(slashIdx + 1))) {
      entries.push({ rel, file })
    }
  })

  for (const { rel, file } of entries) {
    const slashIdx = rel.indexOf('/')
    if (slashIdx === -1) continue
    const path = rel.slice(slashIdx + 1)

    if (path.endsWith('.md')) {
      const content = await file.async('string')
      const remoteSha = await gitBlobSha(content)
      const parsed = parseNote(content)

      classifications.push({
        kind: 'remoteCreated',
        path,
        remoteSha,
        remoteContent: content,
        tags: parsed.tags,
        body: parsed.body,
      })
      continue
    }

    if (isAttachmentPath(path)) {
      const bytes = await file.async('uint8array')
      const remoteSha = await gitBlobShaBytes(bytes)
      const mime = guessMimeFromPath(path)
      classifications.push({ kind: 'attachmentCreated', path, remoteSha, mime })
      // pullFromZipball already has the bytes in memory — stash them so the
      // apply step doesn't issue a redundant per-blob fetch against the API.
      attachmentBytesByPath.set(path, { bytes, mime })
      continue
    }
  }

  return { classifications, latestCommitSha: headSha }
}

// Side-channel cache: pullFromZipball already has the bytes in memory after
// reading the zip, so we stash them here and the apply layer (or anyone
// calling getZipballAttachmentBytes) can grab them without re-downloading.
// Cleared after applyAttachmentClassifications consumes them.
const attachmentBytesByPath = new Map<string, { bytes: Uint8Array; mime: string }>()

export function takeZipballAttachmentBytes(
  path: string,
): { bytes: Uint8Array; mime: string } | null {
  const entry = attachmentBytesByPath.get(path)
  if (!entry) return null
  attachmentBytesByPath.delete(path)
  return entry
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

  // 3b. Local attachments → binary blob entries. Push uploads any local
  // attachment whose SHA differs from the remote. Files only present
  // locally get created remotely; files present in both get updated when
  // their content drifts.
  const localAttachmentPaths = await listAttachmentPaths()
  for (const path of localAttachmentPaths) {
    const localSha = await getAttachmentGitSha(path)
    if (!localSha) continue
    const remoteSha = remoteTree.get(path)
    if (remoteSha === localSha) continue
    const blob = await getAttachmentBlob(path)
    if (!blob) continue
    const uploadedSha = await createBlobBinary(token, owner, name, blob)
    entries.push({ path, mode: '100644', type: 'blob', sha: uploadedSha })
    if (remoteSha) updated++; else created++
  }

  // 3c. Apply attachment tombstones — paths the user explicitly deleted
  // locally need to be removed from the remote tree, otherwise pull would
  // re-download them every cycle (the orphan-comes-back bug). We only
  // delete entries that actually exist remotely; stale tombstones (file
  // already gone remotely) get cleared too.
  const tombstones = await getAttachmentTombstones()
  const consumedTombstones: string[] = []
  for (const path of tombstones) {
    if (remoteTree.has(path)) {
      entries.push({ path, mode: '100644', type: 'blob', sha: null })
      deleted++
    }
    consumedTombstones.push(path)
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
    // Even with no tree changes, clear stale tombstones (files already gone
    // remotely) so they don't re-attempt every sync.
    if (consumedTombstones.length > 0) await clearAttachmentTombstones(consumedTombstones)
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

  // Push succeeded — drop tombstones whose deletes are now in the commit.
  if (consumedTombstones.length > 0) await clearAttachmentTombstones(consumedTombstones)

  return {
    result: { unchanged: false, created, updated, deleted, commitSha, commitUrl: html_url },
    pathUpdates,
  }
}
