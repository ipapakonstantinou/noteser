'use client'

import { useCallback, useState } from 'react'
import { useGitHubStore, useNoteStore, useFolderStore, useWorkspaceStore } from '@/stores'
import { syncToGitHub, pullFromGitHub, pullFromZipball } from '@/utils/githubSync'
import type { PullClassification, SyncResult, GitPathUpdate } from '@/utils/githubSync'
import { applyNonConflicts, applyAttachmentClassifications } from '@/utils/syncApply'
import type { ApplyCounts, AttachmentApplyCounts } from '@/utils/syncApply'
import type { ConflictTabData } from '@/stores/workspaceStore'
import type { SyncRepo } from '@/types'

export type SyncState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; message: string; url: string | null }
  | { kind: 'err'; message: string }

interface UseGitHubSyncResult {
  syncState: SyncState
  runSync: () => Promise<void>
  isConnected: boolean
}

// ── Step 1: PULL ────────────────────────────────────────────────────────────
// Fetch classifications from the remote. On a vault that's still empty
// locally we use the zipball fast path (one archive download instead of N
// blob fetches). After this step we have a complete list of changes to
// classify and apply.
async function runPull(token: string, repo: SyncRepo): Promise<PullClassification[]> {
  const localNotes = useNoteStore.getState().notes
  const localFolders = useFolderStore.getState().folders
  const isFirstClone = !localNotes.some(n => !n.isDeleted)
    && !localFolders.some(f => !f.isDeleted)

  const { classifications } = isFirstClone
    ? await pullFromZipball({ token, repo })
    : await pullFromGitHub({ token, repo, notes: localNotes, folders: localFolders })

  return classifications
}

// ── Step 2: APPLY ───────────────────────────────────────────────────────────
// Walk the classifications and update local stores: notes/folders for
// remote-created/updated/deleted, IDB for attachment binaries. Conflicts
// are skipped here — the caller opens them in the merge UI instead.
async function runApply(
  classifications: PullClassification[],
): Promise<{ notes: ApplyCounts; attachments: AttachmentApplyCounts }> {
  const notes = applyNonConflicts(classifications)
  const attachments = await applyAttachmentClassifications(classifications)
  return { notes, attachments }
}

// ── Step 3: PUSH ────────────────────────────────────────────────────────────
// Upload the local diff to the remote. Returns the GitHub commit info plus
// the per-note path updates so the caller can write them back to the
// noteStore (so subsequent pulls don't see the just-pushed content as a
// remote change).
async function runPush(
  token: string,
  repo: SyncRepo,
): Promise<{ result: SyncResult; pathUpdates: GitPathUpdate[] }> {
  const { notes } = useNoteStore.getState()
  const { folders } = useFolderStore.getState()
  return syncToGitHub({ token, repo, notes, folders })
}

// Compose the human-readable status line shown in the sidebar's sync button.
function formatSyncMessage(
  pulled: ApplyCounts,
  attached: AttachmentApplyCounts,
  pushed: SyncResult,
): string {
  const totalPulled =
    pulled.created + pulled.updated + pulled.deleted +
    attached.created + attached.updated
  if (pushed.unchanged && totalPulled === 0) return 'Up to date'

  const parts: string[] = []
  if (pulled.created) parts.push(`↓${pulled.created} new`)
  if (pulled.updated) parts.push(`↓${pulled.updated} updated`)
  if (pulled.deleted) parts.push(`↓${pulled.deleted} removed`)
  const attachTotal = attached.created + attached.updated
  if (attachTotal) parts.push(`↓${attachTotal} image${attachTotal === 1 ? '' : 's'}`)
  if (pushed.created) parts.push(`↑${pushed.created} new`)
  if (pushed.updated) parts.push(`↑${pushed.updated} updated`)
  if (pushed.deleted) parts.push(`↑${pushed.deleted} deleted`)
  return parts.join(' · ') || 'Synced'
}

// Shared sync handler used by the sidebar's Commit & Sync button and by the
// conflict-resolution modal's "Apply" action. Composes runPull → runApply
// → runPush. On detected conflicts, applies non-conflicts only and opens
// the merge editor instead of pushing.
export function useGitHubSync(): UseGitHubSyncResult {
  const token = useGitHubStore((s) => s.token)
  const syncRepo = useGitHubStore((s) => s.syncRepo)
  const recordSync = useGitHubStore((s) => s.recordSync)
  const openMergeConflicts = useWorkspaceStore((s) => s.openMergeConflicts)

  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' })

  const runSync = useCallback(async () => {
    // Read token + syncRepo from the store at call time rather than relying
    // on the captured values — auto-sync triggered immediately after
    // `setSyncRepo` (e.g. from `GitHubRepoModal`) would otherwise still see
    // the previous repo.
    const { token: activeToken, syncRepo: activeRepo } = useGitHubStore.getState()
    if (!activeToken || !activeRepo) return

    setSyncState({ kind: 'running' })
    try {
      const classifications = await runPull(activeToken, activeRepo)

      const conflicts = classifications.filter(
        c => c.kind === 'conflict' || c.kind === 'conflictDeleted',
      ) as ConflictTabData[]
      if (conflicts.length > 0) {
        // Apply everything that isn't in conflict; leave push for the user
        // to retry after they resolve the merge tabs.
        await runApply(classifications)
        openMergeConflicts(conflicts)
        setSyncState({
          kind: 'err',
          message: `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} need review`,
        })
        return
      }

      const { notes: pullCounts, attachments: attachCounts } = await runApply(classifications)
      const { result, pathUpdates } = await runPush(activeToken, activeRepo)

      // Write the per-note gitPath / gitLastPushedSha back so the next pull
      // classifies us as `unchanged` instead of detecting a phantom remote
      // change.
      const { updateNote } = useNoteStore.getState()
      for (const u of pathUpdates) {
        updateNote(u.noteId, { gitPath: u.gitPath, gitLastPushedSha: u.gitLastPushedSha })
      }
      recordSync(result.commitSha)

      setSyncState({
        kind: 'ok',
        message: formatSyncMessage(pullCounts, attachCounts, result),
        url: result.commitUrl,
      })
      setTimeout(() => setSyncState({ kind: 'idle' }), 5000)
    } catch (err) {
      setSyncState({ kind: 'err', message: err instanceof Error ? err.message : 'Sync failed' })
    }
  }, [token, syncRepo, recordSync, openMergeConflicts])

  return { syncState, runSync, isConnected: !!(token && syncRepo) }
}
