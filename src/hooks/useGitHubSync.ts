'use client'

import { useCallback, useState } from 'react'
import { useGitHubStore, useNoteStore, useFolderStore, useWorkspaceStore } from '@/stores'
import { syncToGitHub, pullFromGitHub, pullFromZipball } from '@/utils/githubSync'
import { applyNonConflicts, applyAttachmentClassifications } from '@/utils/syncApply'
import type { ConflictTabData } from '@/stores/workspaceStore'

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

// Shared sync handler used by the sidebar's Commit & Sync button and by the
// conflict-resolution modal's "Apply" action.  Pulls first; if there are
// conflicts, applies non-conflicts and opens the conflict modal (and stops).
// Otherwise applies the pull then runs the existing push.
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
      // On a first clone the local vault is empty, so every remote file
      // would otherwise become one sequential blob fetch. Switch to the
      // zipball path in that case — one archive download instead of N API
      // round-trips.
      const localNotes = useNoteStore.getState().notes
      const localFolders = useFolderStore.getState().folders
      const isFirstClone = !localNotes.some(n => !n.isDeleted)
        && !localFolders.some(f => !f.isDeleted)

      const { classifications } = isFirstClone
        ? await pullFromZipball({ token: activeToken, repo: activeRepo })
        : await pullFromGitHub({
            token: activeToken,
            repo: activeRepo,
            notes: localNotes,
            folders: localFolders,
          })

      const conflicts = classifications.filter(
        c => c.kind === 'conflict' || c.kind === 'conflictDeleted',
      ) as ConflictTabData[]
      if (conflicts.length > 0) {
        applyNonConflicts(classifications)
        await applyAttachmentClassifications(classifications)
        openMergeConflicts(conflicts)
        setSyncState({ kind: 'err', message: `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} need review` })
        return
      }
      const pullCounts = applyNonConflicts(classifications)
      const attachCounts = await applyAttachmentClassifications(classifications)

      const { notes, updateNote } = useNoteStore.getState()
      const { folders } = useFolderStore.getState()
      const { result, pathUpdates } = await syncToGitHub({
        token: activeToken,
        repo: activeRepo,
        notes,
        folders,
      })
      for (const u of pathUpdates) {
        updateNote(u.noteId, { gitPath: u.gitPath, gitLastPushedSha: u.gitLastPushedSha })
      }
      recordSync(result.commitSha)

      const totalPulled =
        pullCounts.created + pullCounts.updated + pullCounts.deleted +
        attachCounts.created + attachCounts.updated
      if (result.unchanged && totalPulled === 0) {
        setSyncState({ kind: 'ok', message: 'Up to date', url: null })
      } else {
        const parts: string[] = []
        if (pullCounts.created) parts.push(`↓${pullCounts.created} new`)
        if (pullCounts.updated) parts.push(`↓${pullCounts.updated} updated`)
        if (pullCounts.deleted) parts.push(`↓${pullCounts.deleted} removed`)
        const attachTotal = attachCounts.created + attachCounts.updated
        if (attachTotal) parts.push(`↓${attachTotal} image${attachTotal === 1 ? '' : 's'}`)
        if (result.created) parts.push(`↑${result.created} new`)
        if (result.updated) parts.push(`↑${result.updated} updated`)
        if (result.deleted) parts.push(`↑${result.deleted} deleted`)
        setSyncState({ kind: 'ok', message: parts.join(' · ') || 'Synced', url: result.commitUrl })
      }
      setTimeout(() => setSyncState({ kind: 'idle' }), 5000)
    } catch (err) {
      setSyncState({ kind: 'err', message: err instanceof Error ? err.message : 'Sync failed' })
    }
  }, [token, syncRepo, recordSync, openMergeConflicts])

  return { syncState, runSync, isConnected: !!(token && syncRepo) }
}
