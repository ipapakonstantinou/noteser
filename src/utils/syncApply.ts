import { useNoteStore, useFolderStore, useTagStore } from '@/stores'
import type { PullClassification } from './githubSync'
import { sanitizeFilename } from './export'

// ── Folder + tag find-or-create helpers ─────────────────────────────────────

// Walk a `Foo/Bar/Baz` path, ensuring each segment exists as a (non-deleted)
// folder. Returns the leaf folder id, or null for an empty path (= root).
function ensureFolderPath(segments: string[]): string | null {
  if (segments.length === 0) return null
  const { folders, addFolder } = useFolderStore.getState()
  let parentId: string | null = null
  for (const segment of segments) {
    const desired = sanitizeFilename(segment)
    // Look for an existing folder with this sanitized name under the parent.
    const existing = folders.find(
      f => !f.isDeleted && (f.parentId ?? null) === parentId
        && sanitizeFilename(f.name) === desired,
    )
    if (existing) {
      parentId = existing.id
    } else {
      const created = addFolder({ name: segment, parentId })
      parentId = created.id
    }
  }
  return parentId
}

function ensureTagIds(names: string[]): string[] {
  if (names.length === 0) return []
  const { getOrCreateTag } = useTagStore.getState()
  return names.map(n => getOrCreateTag(n).id)
}

// Parse a repo path like "Work/Q1 plan.md" → ({ segments: ['Work'], title: 'Q1 plan' }).
function splitRepoPath(path: string): { segments: string[]; title: string } {
  const parts = path.split('/')
  const file = parts.pop() ?? ''
  const title = file.endsWith('.md') ? file.slice(0, -3) : file
  return { segments: parts, title }
}

// ── Apply ──────────────────────────────────────────────────────────────────

export interface ApplyCounts {
  created: number
  updated: number
  deleted: number
}

export function applyNonConflicts(classifications: PullClassification[]): ApplyCounts {
  const noteStore = useNoteStore.getState()
  const counts: ApplyCounts = { created: 0, updated: 0, deleted: 0 }

  for (const c of classifications) {
    if (c.kind === 'unchanged' || c.kind === 'conflict' || c.kind === 'conflictDeleted') continue

    if (c.kind === 'remoteCreated') {
      const { segments, title } = splitRepoPath(c.path)
      const folderId = ensureFolderPath(segments)
      const tagIds = ensureTagIds(c.tags)
      noteStore.addNote({
        title,
        content: c.body,
        folderId,
        tags: tagIds,
        gitPath: c.path,
        gitLastPushedSha: c.remoteSha,
      })
      counts.created++
      continue
    }

    if (c.kind === 'remoteUpdated') {
      const tagIds = ensureTagIds(c.tags)
      noteStore.updateNote(c.noteId, {
        content: c.body,
        tags: tagIds,
        gitLastPushedSha: c.remoteSha,
      })
      counts.updated++
      continue
    }

    if (c.kind === 'remoteDeleted') {
      noteStore.deleteNote(c.noteId)
      counts.deleted++
      continue
    }
  }

  return counts
}

// Used by the conflict resolver. Critical invariant: after we apply, the next
// pull must NOT classify this note as a conflict again.
//
// For a regular conflict we pin gitLastPushedSha to the *remote* SHA we saw
// at conflict time. Pull's three-way merge then evaluates as
//   lastPushed === remoteSha → remote unchanged
//   lastPushed !== localBlob → local changed
// → push-only, no conflict.
//
// For a conflictDeleted we clear gitPath + gitLastPushedSha so the note is
// treated like a fresh local note: push will create the file from scratch.
export function applyConflictResolution(
  c: Extract<PullClassification, { kind: 'conflict' } | { kind: 'conflictDeleted' }>,
  choice: 'local' | 'remote',
): void {
  const { updateNote, deleteNote } = useNoteStore.getState()
  if (c.kind === 'conflict') {
    if (choice === 'remote') {
      const tagIds = ensureTagIds(c.remoteTags)
      updateNote(c.noteId, { content: c.remoteBody, tags: tagIds, gitLastPushedSha: c.remoteSha })
    } else {
      // Local wins: pretend the remote SHA was the one we pushed, so pull
      // sees "remote unchanged, local changed" → push uploads our content.
      updateNote(c.noteId, { gitLastPushedSha: c.remoteSha })
    }
  } else {
    // conflictDeleted: remote file is gone, but local has unsynced edits.
    if (choice === 'remote') {
      deleteNote(c.noteId)
    } else {
      // Re-spawn: drop the stale path/SHA so push treats it as a new file.
      updateNote(c.noteId, { gitPath: null, gitLastPushedSha: null })
    }
  }
}
