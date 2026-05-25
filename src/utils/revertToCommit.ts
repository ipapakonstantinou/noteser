// "Revert vault to a previous commit" — user-facing rewind.
//
// Workflow: user picks a commit from the Source Control history list,
// clicks the revert button, confirms in a modal. We then:
//
//   1. Fetch the tree at the chosen commit (commitSha → treeSha → blob list).
//   2. For every `.md` blob in that tree, fetch its content.
//   3. Replace the local noteStore: matching notes (by `gitPath`) get
//      their content overwritten; gitPaths in the historical tree that
//      don't exist locally become NEW notes; gitPaths that exist
//      locally but NOT in the historical tree are soft-deleted.
//   4. The caller follows up with a normal push so the GitHub branch
//      catches up — we don't manipulate the remote here.
//
// Why not just force-push the historical commit? Two reasons:
//   - It rewrites history, which is destructive to anyone else cloning.
//   - Reset-then-normal-push leaves a clean "Revert to X" commit on top,
//     preserving the audit trail.
//
// Unpushed local notes are preserved by default (same defence as
// `resetToRemote`). The "wipe-everything" flag is intentionally absent
// for v1 — the revert flow is for "go back to a clean state we already
// pushed", not "destroy unsynced work."

import { useNoteStore } from '@/stores/noteStore'
import {
  getCommitTreeSha,
  getTreeMap,
  getBlobContent,
} from '@/utils/github'
import { parseNote } from '@/utils/githubSync'
import { bodyWithInlineTags } from '@/utils/syncApply'
import { mapWithConcurrency, DEFAULT_CONCURRENCY } from '@/utils/concurrency'
import { withTokenRefresh } from '@/utils/tokenRefresh'
import { v4 as uuidv4 } from 'uuid'

export interface RevertToCommitOptions {
  // Legacy field: kept so existing call sites compile, but the revert now
  // sources a freshly-validated (auto-refreshed) token internally via
  // withTokenRefresh, so a stale token passed here no longer 401s the flow.
  // Pass it or not — it is ignored in favour of the renewal layer's token.
  token?: string
  owner: string
  repo: string
  commitSha: string
  // Optional progress callback fired as historical .md blobs come down, so the
  // UI can show "Fetching N/M…" instead of looking hung on a large vault.
  onBlobProgress?: (fetched: number, total: number) => void
}

export interface RevertToCommitResult {
  // Notes whose content was rewritten to match the historical version.
  replaced: number
  // Notes added because the historical tree had a gitPath we didn't.
  created: number
  // Notes soft-deleted because they exist locally but not in the
  // historical tree.
  removed: number
  // Notes left alone because they were never pushed (no gitPath).
  preservedUnpushed: number
}

// Run the revert. Returns a result summary so the modal can show the
// user what happened. Throws on network failures so the caller can
// surface a friendly error.
export async function revertToCommit(opts: RevertToCommitOptions): Promise<RevertToCommitResult> {
  const { owner, repo, commitSha, onBlobProgress } = opts

  // All GitHub reads run inside withTokenRefresh: it hands us a proactively
  // validated (refreshed if near expiry) token, and if any read still 401s it
  // refreshes once and retries the whole closure with the rotated token. A
  // non-refreshable (PAT/classic) token behaves exactly as before — single
  // attempt, no retry. ReconnectRequiredError surfaces only when truly
  // exhausted, so the modal can route the user to reconnect.
  const historicalContent = await withTokenRefresh(async (token) => {
    // 1. Resolve commit → tree → blob list.
    const treeSha = await getCommitTreeSha(token, owner, repo, commitSha)
    const tree = await getTreeMap(token, owner, repo, treeSha)

    // Filter to `.md` blobs only. Attachments + non-markdown files in
    // the historical tree are left untouched for v1 — they're rarer in
    // the noteser model and would significantly grow the surface area.
    const mdPaths: Array<{ path: string; sha: string }> = []
    for (const [path, sha] of tree) {
      if (path.toLowerCase().endsWith('.md')) {
        mdPaths.push({ path, sha })
      }
    }

    // 2. Fetch every blob's content with a bounded concurrency pool. The Git
    // Data API can't bulk-fetch blobs, so on a real vault the old sequential
    // loop was the "Rewinding…" hang. DEFAULT_CONCURRENCY (8) in flight keeps
    // wall time bounded while staying under GitHub's secondary rate limits.
    // mapWithConcurrency preserves INPUT ORDER, so the resulting map matches
    // the tree-walk order exactly and a mid-batch failure rejects cleanly.
    const total = mdPaths.length
    let fetched = 0
    onBlobProgress?.(0, total)
    const contents = await mapWithConcurrency(
      mdPaths,
      DEFAULT_CONCURRENCY,
      async ({ sha }) => {
        const content = await getBlobContent(token, owner, repo, sha)
        fetched += 1
        onBlobProgress?.(fetched, total)
        return content
      },
    )

    const map = new Map<string, string>()
    mdPaths.forEach(({ path }, i) => map.set(path, contents[i]))
    return map
  })

  // 3. Mutate the noteStore.
  const { notes } = useNoteStore.getState()
  const now = Date.now()
  const byPath = new Map<string, typeof notes[number]>()
  for (const n of notes) {
    if (n.gitPath) byPath.set(n.gitPath, n)
  }

  const result: RevertToCommitResult = {
    replaced: 0,
    created: 0,
    removed: 0,
    preservedUnpushed: 0,
  }

  // Build the next note list. Start with a copy and mutate as we go.
  const next: typeof notes = []
  const handledPaths = new Set<string>()

  // a) Walk historical tree — replace existing notes or create new ones.
  for (const [path, rawContent] of historicalContent) {
    handledPaths.add(path)
    const parsed = parseNote(rawContent)
    const composed = bodyWithInlineTags(parsed.body, parsed.tags)
    // Title is derived from the filename — the noteser pull pipeline
    // does the same thing for new notes coming from remote. We strip
    // the .md extension and fall back to "Untitled" for the malformed
    // edge case.
    const title = path.split('/').pop()?.replace(/\.md$/i, '') || 'Untitled'

    const existing = byPath.get(path)
    if (existing) {
      next.push({
        ...existing,
        title,
        content: composed,
        updatedAt: now,
        isDeleted: false,
        deletedAt: null,
        // Clear gitLastPushedSha so the next push uploads our reverted
        // content rather than thinking the blob is already up to date.
        gitLastPushedSha: null,
      })
      result.replaced += 1
    } else {
      next.push({
        id: uuidv4(),
        title,
        content: composed,
        folderId: null,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
        gitPath: path,
        gitLastPushedSha: null,
      })
      result.created += 1
    }
  }

  // b) Walk local notes — drop pushed ones that aren't in the historical
  // tree (soft-delete so the next push removes them from remote too).
  // Preserve unpushed local notes verbatim.
  for (const n of notes) {
    if (!n.gitPath) {
      next.push(n)
      result.preservedUnpushed += 1
      continue
    }
    if (handledPaths.has(n.gitPath)) continue // already in `next` from (a)
    next.push({
      ...n,
      isDeleted: true,
      deletedAt: now,
      updatedAt: now,
    })
    result.removed += 1
  }

  useNoteStore.setState({
    notes: next,
    selectedNoteId: (() => {
      const cur = useNoteStore.getState().selectedNoteId
      if (cur == null) return null
      return next.some(n => n.id === cur && !n.isDeleted) ? cur : null
    })(),
  })

  return result
}
