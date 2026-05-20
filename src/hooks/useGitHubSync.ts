'use client'

import { useCallback, useEffect, useState } from 'react'
import { useGitHubStore, useNoteStore, useFolderStore, useSettingsStore, useWorkspaceStore } from '@/stores'
import { syncToGitHub, pullFromGitHub, pullFromZipball } from '@/utils/githubSync'
import type { PullClassification, SyncResult, GitPathUpdate } from '@/utils/githubSync'
import { applyNonConflicts, applyAttachmentClassifications } from '@/utils/syncApply'
import type { ApplyCounts, AttachmentApplyCounts } from '@/utils/syncApply'
import type { ConflictTabData } from '@/stores/workspaceStore'
import type { SyncRepo } from '@/types'
import {
  pickVaultSlice,
  serializeVaultSettings,
  vaultSettingsHash,
  vaultSettingsRepoPath,
} from '@/utils/vaultSettings'

export type SyncState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; message: string; url: string | null }
  | { kind: 'err'; message: string }

interface UseGitHubSyncResult {
  syncState: SyncState
  // Optional commitMessage overrides the default "Sync from Noteser (N
  // changes)" — used by the obsidian-git-style message box (vscg).
  runSync: (commitMessage?: string) => Promise<void>
  runPullOnly: () => Promise<void>
  isConnected: boolean
}

// Module-level "once per page load" defensive reset for the global isSyncing
// flag. Only the FIRST useGitHubSync hook to mount in a given session ever
// clears the flag — subsequent hook mounts (e.g. when GitHubRepoModal opens
// mid-sync) must not wipe an in-flight sync's guard.
let isSyncingResetThisSession = false

// ── Step 1: PULL ────────────────────────────────────────────────────────────
// Fetch classifications from the remote. On a vault that's still empty
// locally we use the zipball fast path (one archive download instead of N
// blob fetches). After this step we have a complete list of changes to
// classify and apply.
async function runPull(token: string, repo: SyncRepo): Promise<PullClassification[]> {
  const localNotes = useNoteStore.getState().notes
  const localFolders = useFolderStore.getState().folders
  const excludedFolderPaths = useFolderStore.getState().deletedFolderPaths
  const settings = useSettingsStore.getState()
  const vaultSettingsPath = vaultSettingsRepoPath(settings.settingsFolderPath)
  const isFirstClone = !localNotes.some(n => !n.isDeleted)
    && !localFolders.some(f => !f.isDeleted)

  const { classifications } = isFirstClone
    ? await pullFromZipball({ token, repo })
    : await pullFromGitHub({
        token, repo,
        notes: localNotes, folders: localFolders,
        excludedFolderPaths,
        vaultSettingsPath,
        vaultSettingsLocalUpdatedAt: settings.vaultSettingsUpdatedAt,
      })

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
  commitMessage?: string,
): Promise<{ result: SyncResult; pathUpdates: GitPathUpdate[]; vaultSettingsHashPushed?: string }> {
  const { notes } = useNoteStore.getState()
  const { folders } = useFolderStore.getState()
  const settings = useSettingsStore.getState()
  const vaultPath = vaultSettingsRepoPath(settings.settingsFolderPath)

  // Build the vault settings bundle for the push. Skip when path is
  // unset (settings sync disabled) — syncToGitHub then doesn't touch
  // the file.
  let vaultSettingsInput: Parameters<typeof syncToGitHub>[0]['vaultSettings']
  if (vaultPath) {
    const slice = pickVaultSlice(settings)
    const content = serializeVaultSettings(slice, settings.vaultSettingsUpdatedAt || 0)
    const contentHash = vaultSettingsHash(content)
    vaultSettingsInput = {
      path: vaultPath,
      content,
      contentHash,
      lastPushedHash: settings.vaultSettingsLastPushedHash,
    }
  }

  const outcome = await syncToGitHub({
    token, repo, notes, folders, commitMessage,
    vaultSettings: vaultSettingsInput,
  })
  return outcome
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

  // Defensive: clear any leftover `isSyncing: true` from a sync that never
  // reached its finally block (e.g. tab crash mid-pull, unmount during
  // setState). Without this, a wedged flag would silently kill every
  // subsequent click until the user reloaded the page. We gate this on a
  // module-level "once per session" flag so a later mount (modal opening
  // mid-sync) can't wipe an in-flight sync's guard.
  useEffect(() => {
    if (isSyncingResetThisSession) return
    isSyncingResetThisSession = true
    if (useGitHubStore.getState().isSyncing) {
      useGitHubStore.getState().setIsSyncing(false)
    }
  }, [])

  const runSync = useCallback(async (commitMessage?: string) => {
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

    // Set the global guard INSIDE the try block. Doing it earlier meant a
    // throw between setIsSyncing(true) and entering the try (e.g. React
    // setState during unmount) would leave the flag wedged true forever,
    // silently breaking every subsequent click.
    try {
      setIsSyncing(true)
      setSyncState({ kind: 'running' })
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

      // AI commit messages: when the user has opted in AND didn't
      // pass a custom message via the SCM input, ask the model to
      // draft one from the pending diff. Null result → fall back to
      // the auto-generated default in syncToGitHub.
      let effectiveCommitMessage = commitMessage
      const s = useSettingsStore.getState()
      if (!effectiveCommitMessage && s.aiCommitMessages && s.aiProvider !== 'off' && s.aiApiKey) {
        try {
          const { draftAiCommitMessage } = await import('@/utils/aiCommitMessage')
          const drafted = await draftAiCommitMessage()
          if (drafted) effectiveCommitMessage = drafted
        } catch {
          // Stay silent on AI failure — never block a sync over it.
        }
      }

      const { result, pathUpdates, vaultSettingsHashPushed } = await runPush(activeToken, activeRepo, effectiveCommitMessage)

      // Write the per-note gitPath / gitLastPushedSha back so the next pull
      // classifies us as `unchanged` instead of detecting a phantom remote
      // change.
      const { updateNote } = useNoteStore.getState()
      for (const u of pathUpdates) {
        updateNote(u.noteId, { gitPath: u.gitPath, gitLastPushedSha: u.gitLastPushedSha })
      }
      // Remember the vault settings hash so the next push knows to skip
      // when nothing has changed locally since.
      if (vaultSettingsHashPushed) {
        useSettingsStore.getState().setVaultSettingsLastPushedHash(vaultSettingsHashPushed)
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
    // token + syncRepo are read from useGitHubStore.getState() inside the
    // callback, so they're triggers (so the callback re-binds when the user
    // connects/disconnects) but their values aren't captured. ESLint can't
    // see that — disable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Set the guard INSIDE the try block. See runSync above for the
    // wedged-flag failure mode this avoids.
    try {
      setIsSyncing(true)
      setSyncState({ kind: 'running' })
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
    // See note above re: token + syncRepo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, syncRepo, openMergeConflicts])

  return { syncState, runSync, runPullOnly, isConnected: !!(token && syncRepo) }
}
