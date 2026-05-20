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

import type { Note } from '@/types'

export type ChangeKind = 'created' | 'modified' | 'deleted'

export interface SyncChange {
  noteId: string
  title: string
  /** Repo-relative path the note was last pushed to, or null when never pushed. */
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
): SyncChangeSets {
  const out: SyncChangeSets = { created: [], modified: [], deleted: [] }
  for (const n of notes) {
    const change = classifyOne(n, lastSyncedAt)
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

function classifyOne(n: Note, lastSyncedAt: number | null): SyncChange | null {
  const hasPath = Boolean(n.gitPath)
  // Deleted-but-was-pushed → counts as a pending delete. Deleted but never
  // pushed = nothing for the user to see (already invisible).
  if (n.isDeleted) {
    return hasPath ? mk(n, 'deleted') : null
  }
  // Created = no remote path. We surface even empty notes so the user
  // sees their freshly-created file in Source Control immediately.
  if (!hasPath) {
    return mk(n, 'created')
  }
  // Modified = updatedAt > lastSyncedAt. Cheap heuristic — see file header.
  if (lastSyncedAt == null) {
    // Never synced + has gitPath shouldn't happen normally; treat as modified.
    return mk(n, 'modified')
  }
  if (n.updatedAt > lastSyncedAt) return mk(n, 'modified')
  return null
}

function mk(n: Note, kind: ChangeKind): SyncChange {
  return {
    noteId: n.id,
    title: n.title || 'Untitled',
    gitPath: n.gitPath ?? null,
    kind,
  }
}

// Convenience: total count for the badge.
export function totalPendingCount(sets: SyncChangeSets): number {
  return sets.created.length + sets.modified.length + sets.deleted.length
}
