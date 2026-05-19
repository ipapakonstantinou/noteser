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
  runPullOnly: () => Promise<void>
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
  // Highlight automatic 3-way merges so the user knows the conflict UI was
  // skipped on their behalf.
  if (pulled.autoMerged) parts.push(`auto-merged ${pulled.autoMerged}`)
  return parts.join(' · ') || 'Synced'
}

// Pull-only counterpart to formatSyncMessage — no push counts to report.
// Used by runPullOnly so the sidebar shows what came down without
// pretending we uploaded anything.
function formatPullMessage(
  pulled: ApplyCounts,
  attached: AttachmentApplyCounts,
): string {
  const totalPulled =
    pulled.created + pulled.updated + pulled.deleted +
    attached.created + attached.updated
  if (totalPulled === 0) return 'Up to date'

  const parts: string[] = []
  if (pulled.created) parts.push(`↓${pulled.created} new`)
  if (pulled.updated) parts.push(`↓${pulled.updated} updated`)
  if (pulled.deleted) parts.push(`↓${pulled.deleted} removed`)
  const attachTotal = attached.created + attached.updated
  if (attachTotal) parts.push(`↓${attachTotal} image${attachTotal === 1 ? '' : 's'}`)
  if (pulled.autoMerged) parts.push(`auto-merged ${pulled.autoMerged}`)
  return `Pulled ${parts.join(' · ')}`
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
    const { token: activeToken, syncRepo: activeRepo, isSyncing, setIsSyncing } = useGitHubStore.getState()
    if (!activeToken || !activeRepo) return
    // Global guard: refuse to start a second sync while another one is in
    // flight. Each useGitHubSync caller has its own local syncState, so
    // without this check the sidebar button, the GitHub view, and the
    // auto-sync timer could each fire concurrent syncs (visible in the
    // network panel as a flood of duplicate /blobs POSTs).
    if (isSyncing) return
    setIsSyncing(true)

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
    } finally {
      // Always release the global guard, even on errors / early returns from
      // the conflict branch — otherwise a failed sync wedges every future
      // sync attempt forever.
      useGitHubStore.getState().setIsSyncing(false)
    }
  }, [token, syncRepo, recordSync, openMergeConflicts])

  // Pull-only path: fetch remote, apply non-conflicts, open merge tabs for
  // conflicts, and STOP. Never calls runPush, so local-only edits stay local.
  // Useful before resolving a tough merge by hand, or when the user just
  // wants to grab the latest remote state without uploading work-in-progress.
  const runPullOnly = useCallback(async () => {
    const { token: activeToken, syncRepo: activeRepo, isSyncing, setIsSyncing } = useGitHubStore.getState()
    if (!activeToken || !activeRepo) return
    // Share the same global guard as runSync — a pull-only and a full sync
    // touch the same noteStore, so we can't let them race.
    if (isSyncing) return
    setIsSyncing(true)

    setSyncState({ kind: 'running' })
    try {
      const classifications = await runPull(activeToken, activeRepo)

      const conflicts = classifications.filter(
        c => c.kind === 'conflict' || c.kind === 'conflictDeleted',
      ) as ConflictTabData[]
      if (conflicts.length > 0) {
        // Same conflict-handling branch as runSync: apply everything that
        // isn't in conflict, open merge tabs for the user to resolve.
        await runApply(classifications)
        openMergeConflicts(conflicts)
        setSyncState({
          kind: 'err',
          message: `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} need review`,
        })
        return
      }

      const { notes: pullCounts, attachments: attachCounts } = await runApply(classifications)

      setSyncState({
        kind: 'ok',
        message: formatPullMessage(pullCounts, attachCounts),
        url: null,
      })
      setTimeout(() => setSyncState({ kind: 'idle' }), 5000)
    } catch (err) {
      setSyncState({ kind: 'err', message: err instanceof Error ? err.message : 'Pull failed' })
    } finally {
      useGitHubStore.getState().setIsSyncing(false)
    }
  }, [token, syncRepo, openMergeConflicts])

  return { syncState, runSync, runPullOnly, isConnected: !!(token && syncRepo) }
}
