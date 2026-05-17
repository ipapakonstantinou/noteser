'use client'

import { useCallback, useState } from 'react'
import { useGitHubStore, useNoteStore, useFolderStore, useTagStore, useWorkspaceStore } from '@/stores'
import { syncToGitHub, pullFromGitHub } from '@/utils/githubSync'
import { applyNonConflicts } from '@/utils/syncApply'
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
    if (!token || !syncRepo) return
    setSyncState({ kind: 'running' })
    try {
      const tagsSnapshot = useTagStore.getState().tags
      const tagNamesById = new Map(tagsSnapshot.map(t => [t.id, t.name]))

      const { classifications } = await pullFromGitHub({
        token,
        repo: syncRepo,
        notes: useNoteStore.getState().notes,
        folders: useFolderStore.getState().folders,
        tagNamesById,
      })

      const conflicts = classifications.filter(
        c => c.kind === 'conflict' || c.kind === 'conflictDeleted',
      ) as ConflictTabData[]
      if (conflicts.length > 0) {
        applyNonConflicts(classifications)
        openMergeConflicts(conflicts)
        setSyncState({ kind: 'err', message: `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} need review` })
        return
      }
      const pullCounts = applyNonConflicts(classifications)

      const { notes, updateNote } = useNoteStore.getState()
      const { folders } = useFolderStore.getState()
      const refreshedTags = useTagStore.getState().tags
      const { result, pathUpdates } = await syncToGitHub({
        token,
        repo: syncRepo,
        notes,
        folders,
        tags: refreshedTags.map(t => ({ id: t.id, name: t.name })),
      })
      for (const u of pathUpdates) {
        updateNote(u.noteId, { gitPath: u.gitPath, gitLastPushedSha: u.gitLastPushedSha })
      }
      recordSync(result.commitSha)

      const totalPulled = pullCounts.created + pullCounts.updated + pullCounts.deleted
      if (result.unchanged && totalPulled === 0) {
        setSyncState({ kind: 'ok', message: 'Up to date', url: null })
      } else {
        const parts: string[] = []
        if (pullCounts.created) parts.push(`↓${pullCounts.created} new`)
        if (pullCounts.updated) parts.push(`↓${pullCounts.updated} updated`)
        if (pullCounts.deleted) parts.push(`↓${pullCounts.deleted} removed`)
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
