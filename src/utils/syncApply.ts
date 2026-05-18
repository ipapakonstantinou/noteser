import { useNoteStore, useFolderStore } from '@/stores'
import type { PullClassification } from './githubSync'
import { parseNote } from './githubSync'
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

// Tags from frontmatter are merged into the body as `#tag` so they survive
// in the derived-tags model.
function bodyWithInlineTags(body: string, frontmatterTags: string[]): string {
  if (frontmatterTags.length === 0) return body
  const prefix = frontmatterTags.map(t => `#${t}`).join(' ')
  // Don't add a duplicate prefix if the body already starts with it (rare,
  // but happens on round-trips between Noteser versions).
  if (body.startsWith(prefix)) return body
  return `${prefix}\n\n${body}`
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
      noteStore.addNote({
        title,
        content: bodyWithInlineTags(c.body, c.tags),
        folderId,
        gitPath: c.path,
        gitLastPushedSha: c.remoteSha,
      })
      counts.created++
      continue
    }

    if (c.kind === 'remoteUpdated') {
      noteStore.updateNote(c.noteId, {
        content: bodyWithInlineTags(c.body, c.tags),
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

// Used by the new merge-editor flow: the user produced a merged body of the
// note (line-by-line cherry pick). We store it as the note's content and pin
// gitLastPushedSha to the remote SHA so pull doesn't see this as a conflict
// again — push will upload the merged content on the next sync.
export function applyMergedConflict(
  c: Extract<PullClassification, { kind: 'conflict' }>,
  mergedRawFile: string,
): void {
  const { updateNote } = useNoteStore.getState()
  // The diff was on the raw file content (possibly with legacy frontmatter).
  // Re-parse to strip any tags block; merge those tags into the body.
  const parsed = parseNote(mergedRawFile)
  updateNote(c.noteId, {
    content: bodyWithInlineTags(parsed.body, parsed.tags),
    gitLastPushedSha: c.remoteSha,
  })
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
      updateNote(c.noteId, {
        content: bodyWithInlineTags(c.remoteBody, c.remoteTags),
        gitLastPushedSha: c.remoteSha,
      })
    } else {
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
