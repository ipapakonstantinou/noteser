'use client'

import { useMemo } from 'react'
import { ArrowPathIcon, FireIcon, SignalIcon, SignalSlashIcon } from '@heroicons/react/24/outline'
import { extractTags } from '@/utils/tags'
import { useGitHubStore, useNoteStore, useUIStore, useSettingsStore, useFolderStore } from '@/stores'
import { classifyPendingChanges, totalPendingCount } from '@/utils/syncChanges'
import { computeStreakFromDateStrings, dailyDateSet } from '@/utils/dailyStreak'
import { useCollaboration } from '@/hooks/useCollaboration'
import type { Note } from '@/types'

interface EditorFooterProps {
  note: Note
}

// Slim status bar at the bottom of a pane. Matches Obsidian's status-bar
// placement: sync/branch context on the left, counts on the right.
export const EditorFooter = ({ note }: EditorFooterProps) => {
  const syncRepo = useGitHubStore(s => s.syncRepo)
  const lastSyncedAt = useGitHubStore(s => s.lastSyncedAt)
  const isSyncing = useGitHubStore(s => s.isSyncing)
  const notes = useNoteStore(s => s.notes)
  const folders = useFolderStore(s => s.folders)
  const setCurrentView = useUIStore(s => s.setCurrentView)

  const tagCount = extractTags(note.content).length
  const wordCount = note.content.trim().split(/\s+/).filter(Boolean).length
  const charCount = note.content.length

  // Daily-note streak — derived from active note titles + the user's
  // dailyNoteDateFormat. Memoised so we don't recompute on every
  // keystroke (notes is the deps trigger). Re-runs roughly once per
  // note save.
  const dailyNoteDateFormat = useSettingsStore(s => s.dailyNoteDateFormat) || 'YYYY-MM-DD'
  const streak = useMemo(() => {
    const titles = notes.filter(n => !n.isDeleted).map(n => n.title)
    const dateSet = dailyDateSet(titles, dailyNoteDateFormat)
    return computeStreakFromDateStrings(dateSet, dailyNoteDateFormat)
  }, [notes, dailyNoteDateFormat])

  // Pending-changes count drives the badge next to "synced X ago".
  // Reuses the same classifier the Source Control panel uses so the
  // numbers always agree.
  const pendingCount = useMemo(
    () => syncRepo ? totalPendingCount(classifyPendingChanges(notes, lastSyncedAt, folders)) : 0,
    [syncRepo, notes, lastSyncedAt, folders],
  )

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  const formatRelative = (timestamp: number) => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000)
    if (diffSec < 60) return 'just now'
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
    return `${Math.floor(diffSec / 86400)}d ago`
  }

  const syncLabel = syncRepo
    ? lastSyncedAt
      ? `synced ${formatRelative(lastSyncedAt)}`
      : 'not yet synced'
    : null

  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-1 text-[11px] text-obsidianSecondaryText border-t border-obsidianBorder"
      data-testid="status-bar-footer"
    >
      <div className="flex items-center gap-3 truncate">
        {syncRepo && (
          <>
            <span className="truncate" title={`${syncRepo.owner}/${syncRepo.name}`}>
              {syncRepo.owner}/{syncRepo.name}
            </span>
            <span className="text-obsidianBorder">·</span>
            <span>{syncRepo.branch}</span>
            <span className="text-obsidianBorder">·</span>
            {isSyncing ? (
              <span
                className="flex items-center gap-1 text-obsidianAccentPurple"
                data-testid="status-bar-syncing"
              >
                <ArrowPathIcon className="w-3 h-3 animate-spin" />
                <span>Syncing…</span>
              </span>
            ) : (
              <span>{syncLabel}</span>
            )}
            {!isSyncing && pendingCount > 0 && (
              <>
                <span className="text-obsidianBorder">·</span>
                <button
                  type="button"
                  onClick={() => setCurrentView('github')}
                  className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                  title="Open Source Control panel"
                  data-testid="status-bar-pending"
                >
                  {pendingCount} pending
                </button>
              </>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <CollabPill />
        {streak.length >= 2 && (
          <span
            className="flex items-center gap-1 text-orange-400"
            title={streak.includesToday
              ? `${streak.length}-day daily-note streak — keep it going!`
              : `${streak.length}-day streak — write today's note to keep it alive.`}
            data-testid="status-bar-streak"
          >
            <FireIcon className="w-3 h-3" />
            <span>{streak.length}d</span>
          </span>
        )}
        {tagCount > 0 && <span>{tagCount} tag{tagCount === 1 ? '' : 's'}</span>}
        <span>{wordCount} word{wordCount === 1 ? '' : 's'}</span>
        <span>{charCount} char{charCount === 1 ? '' : 's'}</span>
        <span>Modified {formatDate(note.updatedAt)}</span>
      </div>
    </div>
  )
}

// Tiny presence pill — shows the live-collab WebSocket health when
// NEXT_PUBLIC_YJS_WS_URL is configured. Hidden when collab is off so
// the footer stays uncluttered for the default single-user case.
function CollabPill() {
  const { status, attempts, url } = useCollaboration()
  if (status === 'off' || url == null) return null

  const labelByStatus: Record<Exclude<typeof status, 'off'>, string> = {
    connecting: 'Live: connecting…',
    connected: 'Live: on',
    disconnected: attempts > 0 ? `Live: retrying (${attempts}/5)` : 'Live: paused',
    error: 'Live: unreachable',
  }
  const colorByStatus: Record<Exclude<typeof status, 'off'>, string> = {
    connecting: 'text-amber-400',
    connected: 'text-green-500',
    disconnected: 'text-amber-400',
    error: 'text-red-400',
  }
  const Icon = status === 'connected' ? SignalIcon : SignalSlashIcon

  return (
    <span
      className={`flex items-center gap-1 ${colorByStatus[status]}`}
      title={`${labelByStatus[status]} · ${url}`}
      data-testid="status-bar-collab"
    >
      <Icon className="w-3 h-3" />
      <span>{labelByStatus[status]}</span>
    </span>
  )
}

export default EditorFooter
