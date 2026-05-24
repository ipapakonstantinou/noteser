'use client'

import { useCallback, useEffect, useState } from 'react'
import { useGitHubStore, useNoteStore, useFolderStore, useSettingsStore, useWorkspaceStore, useUIStore } from '@/stores'
import { useToastStore } from '@/stores/toastStore'
import { VaultLockedError } from '@/utils/vaultKey'
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
  // Optional message: shown while a sync is genuinely in flight, but also
  // reused as a transient "already in progress" notice when a click hits
  // the global in-flight guard (so the guard no longer fails silently).
  | { kind: 'running'; message?: string }
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

// Watchdog: the hard ceiling on how long a single sync may hold the global
// isSyncing flag. On mobile a fetch can stall indefinitely (no timeout on
// fetch itself), and without this the `await` never settles, the `finally`
// never runs, and isSyncing stays true for the whole session — wedging every
// button until a page reload. After this many ms we force the UI to recover:
// clear the flag, abort in-flight fetches where supported, and surface a
// retryable error. 45s is comfortably longer than a healthy large-vault sync
// but short enough that a wedged tab self-heals while the user is still there.
const SYNC_WATCHDOG_MS = 45_000

// Sentinel thrown by the watchdog branch so the caller can tell a genuine
// failure apart from "we gave up waiting". The catch blocks map it to the
// timeout message; the surrounding race guarantees isSyncing is already
// cleared by the time it surfaces.
class SyncTimeoutError extends Error {
  constructor() {
    super('Sync timed out — check your connection and retry.')
    this.name = 'SyncTimeoutError'
  }
}

// Race `work` against the watchdog. If the work settles first, the timer is
// cleared and its result/rejection passes straight through. If the watchdog
// wins, we abort the controller (cancelling any abort-aware fetch) and throw
// SyncTimeoutError. A `settled` flag makes the two outcomes mutually
// exclusive so a late-resolving `work` can never flip state back after the
// timeout already recovered the UI.
async function withSyncWatchdog<T>(
  controller: AbortController,
  work: () => Promise<T>,
): Promise<T> {
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (settled) return
      settled = true
      // Best-effort: cancel any fetch that wired up controller.signal. Fetches
      // that are not yet abort-aware keep running in the background, but the
      // race below has already let go of the UI.
      try { controller.abort() } catch { /* abort is best-effort */ }
      reject(new SyncTimeoutError())
    }, SYNC_WATCHDOG_MS)
  })

  try {
    const result = await Promise.race([work(), timeout])
    // Work won the race. Guard against a watchdog that fired in the same tick.
    if (!settled) {
      settled = true
      if (timer) clearTimeout(timer)
    }
    return result
  } catch (err) {
    if (!settled) {
      settled = true
      if (timer) clearTimeout(timer)
    }
    throw err
  }
}

// ── Step 1: PULL ────────────────────────────────────────────────────────────
// Fetch classifications from the remote. On a vault that's still empty
// locally we use the zipball fast path (one archive download instead of N
// blob fetches). After this step we have a complete list of changes to
// classify and apply.
// Returns both the classifications AND the remote HEAD sha. runPullOnly
// needs the sha so a successful pull-only can update lastCommitSha via
// recordSync — matching what runSync does with the push commit sha.
async function runPull(
  token: string,
  repo: SyncRepo,
  // Phase callback so the caller (which owns setSyncState) can surface a
  // running message for the branch we actually take. runPull itself is a module
  // function with no store access, so it just announces which path it runs.
  onPhase?: (msg: string) => void,
): Promise<{ classifications: PullClassification[]; latestCommitSha: string }> {
  const localNotes = useNoteStore.getState().notes
  const localFolders = useFolderStore.getState().folders
  const excludedFolderPaths = useFolderStore.getState().deletedFolderPaths
  const settings = useSettingsStore.getState()
  const vaultSettingsPath = vaultSettingsRepoPath(settings.settingsFolderPath)
  const isFirstClone = !localNotes.some(n => !n.isDeleted)
    && !localFolders.some(f => !f.isDeleted)

  // First clone downloads the whole repo as one archive (the slow step on a
  // large vault); an incremental pull just diffs the tree. Tell the two apart
  // so the status line is honest about what's taking time.
  onPhase?.(isFirstClone ? 'Downloading vault…' : 'Checking for changes…')

  const { classifications, latestCommitSha } = isFirstClone
    ? await pullFromZipball({ token, repo })
    : await pullFromGitHub({
        token, repo,
        notes: localNotes, folders: localFolders,
        excludedFolderPaths,
        vaultSettingsPath,
        vaultSettingsLocalUpdatedAt: settings.vaultSettingsUpdatedAt,
      })

  return { classifications, latestCommitSha }
}

// ── Step 2: APPLY ───────────────────────────────────────────────────────────
// Walk the classifications and update local stores: notes/folders for
// remote-created/updated/deleted, IDB for attachment binaries. Conflicts
// are skipped here — the caller opens them in the merge UI instead.
async function runApply(
  classifications: PullClassification[],
): Promise<{ notes: ApplyCounts; attachments: AttachmentApplyCounts }> {
  const notes = await applyNonConflicts(classifications)
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
): Promise<{ result: SyncResult; pathUpdates: GitPathUpdate[]; vaultSettingsHashPushed?: string; vaultGitignorePushed?: boolean }> {
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
    // gi9n: thread the editor's draft through. Null = no pending edit;
    // syncToGitHub will leave the remote `.gitignore` alone.
    vaultGitignoreDraft: settings.vaultGitignoreDraft,
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
  const openMergeBatch = useWorkspaceStore((s) => s.openMergeBatch)
  // Threshold above which we route conflicts through the batch summary
  // tab instead of opening N individual merge-conflict tabs. Three is
  // the point where the tab strip starts to get cluttered; below that,
  // the inline merge editor is faster.
  const BATCH_THRESHOLD = 3

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
    if (isSyncing) {
      // Surface the guard trip instead of failing silently. Another sync
      // (e.g. the startup auto-pull from a different hook instance) holds
      // the global flag, so this click would otherwise do nothing visible.
      // The store flag already keeps the buttons disabled; this is the
      // belt-and-braces feedback for any click that still lands.
      setSyncState({ kind: 'running', message: 'Sync already in progress' })
      return
    }

    // Set the global guard INSIDE the try block. Doing it earlier meant a
    // throw between setIsSyncing(true) and entering the try (e.g. React
    // setState during unmount) would leave the flag wedged true forever,
    // silently breaking every subsequent click.
    //
    // The whole sync runs inside withSyncWatchdog: after SYNC_WATCHDOG_MS the
    // watchdog clears the guard, aborts the controller, and rejects with
    // SyncTimeoutError — guaranteeing recovery even if a fetch hangs forever.
    const controller = new AbortController()
    try {
      setIsSyncing(true)
      setSyncState({ kind: 'running' })
      await withSyncWatchdog(controller, async () => {
        const { classifications } = await runPull(activeToken, activeRepo, (msg) =>
          setSyncState({ kind: 'running', message: msg }),
        )

        const conflicts = classifications.filter(
          c => c.kind === 'conflict' || c.kind === 'conflictDeleted',
        ) as ConflictTabData[]
        if (conflicts.length > 0) {
          // Apply everything that isn't in conflict; leave push for the user
          // to retry after they resolve the merge tabs.
          setSyncState({ kind: 'running', message: 'Applying changes…' })
          await runApply(classifications)
          if (conflicts.length >= BATCH_THRESHOLD) {
            openMergeBatch(conflicts)
          } else {
            openMergeConflicts(conflicts)
          }
          const conflictMsg = `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} need review`
          setSyncState({ kind: 'err', message: conflictMsg })
          useToastStore.getState().addToast({ kind: 'info', message: conflictMsg })
          return
        }

        setSyncState({ kind: 'running', message: 'Applying changes…' })
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

        setSyncState({ kind: 'running', message: 'Pushing…' })
        const { result, pathUpdates, vaultSettingsHashPushed, vaultGitignorePushed } = await runPush(activeToken, activeRepo, effectiveCommitMessage)

        // Write the per-note gitPath / gitLastPushedSha back so the next pull
        // classifies us as `unchanged` instead of detecting a phantom remote
        // change.
        const { updateNote } = useNoteStore.getState()
        for (const u of pathUpdates) {
          updateNote(u.noteId, { gitPath: u.gitPath, gitLastPushedSha: u.gitLastPushedSha, gitRemoteBaseSha: u.gitRemoteBaseSha })
        }
        // Remember the vault settings hash so the next push knows to skip
        // when nothing has changed locally since.
        if (vaultSettingsHashPushed) {
          useSettingsStore.getState().setVaultSettingsLastPushedHash(vaultSettingsHashPushed)
        }
        // gi9n: if we just pushed the `.gitignore` draft, clear it and
        // snapshot the pushed content as the new remote baseline so the
        // editor stops showing a dirty marker and the next sync skips.
        if (vaultGitignorePushed) {
          const s2 = useSettingsStore.getState()
          const pushed = s2.vaultGitignoreDraft
          s2.setVaultGitignoreRemoteSnapshot(pushed)
          s2.setVaultGitignoreDraft(null)
        }
        recordSync(result.commitSha)

        const okMessage = formatSyncMessage(pullCounts, attachCounts, result)
        setSyncState({
          kind: 'ok',
          message: okMessage,
          url: result.commitUrl,
        })
        useToastStore.getState().addToast({ kind: 'success', message: okMessage })
        setTimeout(() => setSyncState({ kind: 'idle' }), 5000)
      })
    } catch (err) {
      // Watchdog tripped — the sync ran past SYNC_WATCHDOG_MS. The guard is
      // released in finally; surface a retryable error rather than a stuck
      // spinner. The hung fetch (if any) keeps running in the background but
      // no longer holds the UI.
      if (err instanceof SyncTimeoutError) {
        setSyncState({ kind: 'err', message: err.message })
        useToastStore.getState().addToast({
          kind: 'error', message: err.message,
          actionLabel: 'Retry', onAction: () => { void runSync(commitMessage) },
        })
      } else if (err instanceof VaultLockedError) {
        // Vault encryption is on but locked — the sync layer throws
        // VaultLockedError before any HTTP traffic. Surface as an
        // unlock prompt rather than a generic "Sync failed" message so
        // the user has a one-click path back to working sync.
        useUIStore.getState().openModal({ type: 'vault-encryption', data: { mode: 'unlock' } })
        setSyncState({ kind: 'err', message: 'Vault is locked — unlock to sync.' })
      } else {
        const message = err instanceof Error ? err.message : 'Sync failed'
        setSyncState({ kind: 'err', message })
        useToastStore.getState().addToast({
          kind: 'error', message,
          actionLabel: 'Retry', onAction: () => { void runSync(commitMessage) },
        })
      }
    } finally {
      // Always release the global guard, even on errors / early returns from
      // the conflict branch, AND on a watchdog timeout — otherwise a failed
      // or hung sync wedges every future sync attempt forever.
      useGitHubStore.getState().setIsSyncing(false)
    }
    // token + syncRepo are read from useGitHubStore.getState() inside the
    // callback, so they're triggers (so the callback re-binds when the user
    // connects/disconnects) but their values aren't captured. ESLint can't
    // see that — disable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, syncRepo, recordSync, openMergeConflicts, openMergeBatch])

  // Pull-only path: fetch remote, apply non-conflicts, open merge tabs for
  // conflicts, and STOP. Never calls runPush, so local-only edits stay local.
  // Useful before resolving a tough merge by hand, or when the user just
  // wants to grab the latest remote state without uploading work-in-progress.
  const runPullOnly = useCallback(async () => {
    const { token: activeToken, syncRepo: activeRepo, isSyncing, setIsSyncing } = useGitHubStore.getState()
    if (!activeToken || !activeRepo) return
    // Share the same global guard as runSync — a pull-only and a full sync
    // touch the same noteStore, so we can't let them race.
    if (isSyncing) {
      // Same feedback as runSync: a click that hits the guard (most often
      // during the startup auto-pull, which holds the global flag from a
      // different hook instance) gets a visible notice rather than silence.
      setSyncState({ kind: 'running', message: 'Sync already in progress' })
      return
    }

    // Set the guard INSIDE the try block. See runSync above for the
    // wedged-flag failure mode this avoids. Same watchdog guarantee: after
    // SYNC_WATCHDOG_MS the flag is cleared and a retryable error is shown,
    // even if the remote fetch never settles (the mobile-stall bug).
    const controller = new AbortController()
    try {
      setIsSyncing(true)
      setSyncState({ kind: 'running' })
      await withSyncWatchdog(controller, async () => {
        const { classifications, latestCommitSha } = await runPull(activeToken, activeRepo, (msg) =>
          setSyncState({ kind: 'running', message: msg }),
        )

        const conflicts = classifications.filter(
          c => c.kind === 'conflict' || c.kind === 'conflictDeleted',
        ) as ConflictTabData[]
        if (conflicts.length > 0) {
          // Same conflict-handling branch as runSync: apply everything that
          // isn't in conflict, open merge tabs (batch view above
          // BATCH_THRESHOLD) for the user to resolve.
          setSyncState({ kind: 'running', message: 'Applying changes…' })
          await runApply(classifications)
          if (conflicts.length >= BATCH_THRESHOLD) {
            openMergeBatch(conflicts)
          } else {
            openMergeConflicts(conflicts)
          }
          const conflictMsg = `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} need review`
          setSyncState({ kind: 'err', message: conflictMsg })
          useToastStore.getState().addToast({ kind: 'info', message: conflictMsg })
          return
        }

        setSyncState({ kind: 'running', message: 'Applying changes…' })
        const { notes: pullCounts, attachments: attachCounts } = await runApply(classifications)

        // Record the pulled HEAD as the new baseline so lastCommitSha tracks
        // the remote after a pull-only too. Previously only runSync called
        // recordSync (with the push commit sha), so a pull-only left
        // lastCommitSha stale — the footer commit link and RecentCommits
        // refetch both key off it.
        recordSync(latestCommitSha)

        const okMessage = formatPullMessage(pullCounts, attachCounts)
        setSyncState({
          kind: 'ok',
          message: okMessage,
          url: null,
        })
        useToastStore.getState().addToast({ kind: 'success', message: okMessage })
        setTimeout(() => setSyncState({ kind: 'idle' }), 5000)
      })
    } catch (err) {
      if (err instanceof SyncTimeoutError) {
        setSyncState({ kind: 'err', message: err.message })
        useToastStore.getState().addToast({
          kind: 'error', message: err.message,
          actionLabel: 'Retry', onAction: () => { void runPullOnly() },
        })
      } else if (err instanceof VaultLockedError) {
        useUIStore.getState().openModal({ type: 'vault-encryption', data: { mode: 'unlock' } })
        setSyncState({ kind: 'err', message: 'Vault is locked — unlock to pull.' })
      } else {
        const message = err instanceof Error ? err.message : 'Pull failed'
        setSyncState({ kind: 'err', message })
        useToastStore.getState().addToast({
          kind: 'error', message,
          actionLabel: 'Retry', onAction: () => { void runPullOnly() },
        })
      }
    } finally {
      useGitHubStore.getState().setIsSyncing(false)
    }
    // See note above re: token + syncRepo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, syncRepo, recordSync, openMergeConflicts, openMergeBatch])

  return { syncState, runSync, runPullOnly, isConnected: !!(token && syncRepo) }
}
