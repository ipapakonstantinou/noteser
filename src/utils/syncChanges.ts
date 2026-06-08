// Classify local notes into "pending changes" for the source-control
// sidebar — the VS Code-style panel that lets the user see what's about
// to be pushed before they click Sync.
//
// We use a CHEAP heuristic (not a real SHA-1 compare) so this can run on
// every store change without burning CPU. The real sync still computes
// blob SHAs against the remote tree for the actual push decision; this
// classification is purely UX. False positives are fine — the user just
// sees an entry that turns out to be a no-op.
//
//   created  — gitPath is null (note has never been pushed)
//   modified — gitPath is set AND updatedAt > lastSyncedAt
//   deleted  — gitPath is set AND isDeleted is true
//   unchanged — everything else
//
// We INCLUDE empty new notes (no content yet) in `created`. The user's
// mental model: "I made a file, I should see it in Source Control."
// The actual push will skip a truly-empty file via the blob de-dup,
// so this is purely a display nicety.
//
// The `unchanged` set isn't returned (the panel only cares about pending
// work). The order of priority above also handles the "deleted note that
// was never pushed" edge case — it's not in any bucket.

import type { Note, Folder } from '@/types'

export type ChangeKind = 'created' | 'modified' | 'deleted'

export interface SyncChange {
  noteId: string
  title: string
  /** Repo-relative path the change will live at on the remote.
   *  - For a synced note (created/modified/deleted): the stored `Note.gitPath`.
   *  - For a CREATED (never-pushed) note when `folders` is supplied: a
   *    SYNTHETIC path derived from the note's folder hierarchy + title + `.md`,
   *    mirroring where the note WILL land on the next push. This lets the
   *    Source Control tree group new notes under their folder instead of
   *    dumping them all at the repo root (the bug fix in
   *    fix/created-note-source-control-tree-bug).
   *  - Null only when the note has no path AND no folders were supplied
   *    (legacy callers that didn't thread folders through).
   */
  gitPath: string | null
  kind: ChangeKind
}

export interface SyncChangeSets {
  created: SyncChange[]
  modified: SyncChange[]
  deleted: SyncChange[]
}

export function classifyPendingChanges(
  notes: Note[],
  lastSyncedAt: number | null,
  folders?: Folder[],
): SyncChangeSets {
  const out: SyncChangeSets = { created: [], modified: [], deleted: [] }
  for (const n of notes) {
    const change = classifyOne(n, lastSyncedAt, folders)
    if (change) out[change.kind].push(change)
  }
  // Sort each bucket alphabetically by title so the panel stays stable
  // across re-renders (otherwise insertion order is whatever the store
  // happened to be in).
  for (const bucket of [out.created, out.modified, out.deleted]) {
    bucket.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }
  return out
}

function classifyOne(n: Note, lastSyncedAt: number | null, folders?: Folder[]): SyncChange | null {
  // A not-yet-loaded shell (progressive clone) is a placeholder, not a local
  // change — its body has not been fetched, so it is in sync with remote by
  // definition. Never count it as pending (it is also excluded from push).
  if (n.contentLoaded === false) return null
  const hasPath = Boolean(n.gitPath)
  // Deleted-but-was-pushed → counts as a pending delete. Deleted but never
  // pushed = nothing for the user to see (already invisible).
  if (n.isDeleted) {
    return hasPath ? mk(n, 'deleted', folders) : null
  }
  // Created = no remote path. We surface even empty notes so the user
  // sees their freshly-created file in Source Control immediately.
  if (!hasPath) {
    return mk(n, 'created', folders)
  }
  // Modified = updatedAt > lastSyncedAt. Cheap heuristic — see file header.
  if (lastSyncedAt == null) {
    // Never synced + has gitPath shouldn't happen normally; treat as modified.
    return mk(n, 'modified', folders)
  }
  if (n.updatedAt > lastSyncedAt) return mk(n, 'modified', folders)
  return null
}

// Build the repo-relative path a created note WILL live at on the next push.
// Walks `folders` up to the root via parentId, prepending each segment, then
// appends "<title>.md". Mirrors `notePath()` in githubSync/internal.ts (and
// would happily share that helper if it didn't drag the sanitizer + git stack
// into this UX-only module — keeping this inline keeps syncChanges
// dependency-free outside of @/types). Falls back to a bare "<title>.md" when
// the parent folder can't be located (orphaned note, or folders not passed).
function deriveCreatedGitPath(note: Note, folders: Folder[] | undefined): string {
  const filename = `${note.title || 'Untitled'}.md`
  if (!folders || !note.folderId) return filename
  const byId = new Map(folders.map(f => [f.id, f]))
  const segments: string[] = []
  let cur: Folder | undefined = byId.get(note.folderId)
  // Cap the walk so a corrupted parent cycle can't spin forever.
  for (let i = 0; cur && i < 32; i++) {
    if (cur.isDeleted) break
    segments.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  segments.push(filename)
  return segments.join('/')
}

function mk(n: Note, kind: ChangeKind, folders?: Folder[]): SyncChange {
  // Created notes have no stored gitPath yet — derive a SYNTHETIC one from
  // the folder hierarchy so the Source Control tree nests them under the
  // folder they'll be pushed to. Without this, the panel's
  // groupChangesByFolder falls back to `change.title` (the bug visible
  // 2026-06-08: a new daily note "2026-06-16" landed at the repo root
  // instead of under Notes/Daily). The push side reads `note.gitPath`
  // directly (see pushPath()), so this synthetic path is purely a display
  // hint — it doesn't leak into push decisions.
  const gitPath = n.gitPath ?? (kind === 'created' ? deriveCreatedGitPath(n, folders) : null)
  return {
    noteId: n.id,
    title: n.title || 'Untitled',
    gitPath,
    kind,
  }
}

// Convenience: total count for the badge.
export function totalPendingCount(sets: SyncChangeSets): number {
  return sets.created.length + sets.modified.length + sets.deleted.length
}
