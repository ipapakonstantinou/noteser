'use client'

import { useMemo } from 'react'
import { ArrowPathIcon, FireIcon, SignalIcon, SignalSlashIcon, ShareIcon } from '@heroicons/react/24/outline'
import { extractTags } from '@/utils/tags'
import { useGitHubStore, useNoteStore, useUIStore, useSettingsStore, useFolderStore, useWorkspaceStore } from '@/stores'
import { useToastStore } from '@/stores/toastStore'
import { classifyPendingChanges, totalPendingCount } from '@/utils/syncChanges'
import { computeStreakFromDateStrings, dailyDateSet } from '@/utils/dailyStreak'
import { useCollaboration, getConfiguredUrl } from '@/hooks/useCollaboration'
import { buildCollabShareLink } from '@/utils/collabShare'
import { useActiveCollabStore } from '@/stores/activeCollabStore'
import { useHydration } from '@/hooks'

// App-wide status bar — ONE slim strip across the bottom of the window
// (VS Code / Obsidian placement), not one per pane. Vertical splits used
// to leave a per-pane copy of this bar stranded mid-screen between two
// stacked editors. Sync/branch context on the left; the right side shows
// counts for the ACTIVE pane's active note (merge views, the Welcome tab,
// and an empty workspace keep the bar but drop the note segments).
export const EditorFooter = () => {
  // Persisted stores hydrate client-side only; render the bare shell
  // until then so SSR and the first client paint stay identical.
  const hydrated = useHydration()
  const syncRepo = useGitHubStore(s => s.syncRepo)
  const lastSyncedAt = useGitHubStore(s => s.lastSyncedAt)
  const isSyncing = useGitHubStore(s => s.isSyncing)
  const notes = useNoteStore(s => s.notes)
  const folders = useFolderStore(s => s.folders)
  const setCurrentView = useUIStore(s => s.setCurrentView)

  // Active pane → active tab → note (only when that tab is a note tab).
  const activeNoteId = useWorkspaceStore(s => {
    const pane = s.panes.find(p => p.id === s.activePaneId) ?? s.panes[0]
    const tab = pane?.tabs.find(t => t.id === pane.activeTabId)
    return tab?.kind === 'note' ? tab.noteId : null
  })
  const note = notes.find(n => n.id === activeNoteId) ?? null

  const tagCount = note ? extractTags(note.content).length : 0
  const wordCount = note ? note.content.trim().split(/\s+/).filter(Boolean).length : 0
  const charCount = note ? note.content.length : 0

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
        {hydrated && syncRepo && (
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
                  className="px-1.5 py-0.5 rounded-sm bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
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
        {hydrated && (
          <>
            <ShareCollabButton noteId={activeNoteId} />
            <LiveCollabToggle noteId={activeNoteId} />
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
            {note && (
              <>
                {tagCount > 0 && <span>{tagCount} tag{tagCount === 1 ? '' : 's'}</span>}
                <span>{wordCount} word{wordCount === 1 ? '' : 's'}</span>
                <span>{charCount} char{charCount === 1 ? '' : 's'}</span>
                <span>Modified {formatDate(note.updatedAt)}</span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Feature A — "Share" affordance. Visible ONLY when live collaboration is
// configured (getConfiguredUrl() non-null) AND a note is open. Clicking it
// mints (or reuses) the note's stable collabId, copies a share link to the
// clipboard, and confirms with a toast. Anyone who opens that link joins the
// same room and can edit the note live — the UUID room id is the only
// credential, so nothing else is leaked.
function ShareCollabButton({ noteId }: { noteId: string | null }) {
  const url = getConfiguredUrl()
  if (!url || !noteId) return null

  const onShare = async () => {
    const collabId = useNoteStore.getState().ensureCollabId(noteId)
    if (!collabId) return
    const note = useNoteStore.getState().notes.find(n => n.id === noteId)
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const link = buildCollabShareLink(origin, collabId, note?.title)
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // Clipboard API unavailable (insecure context / older browser) — fall
      // back to a prompt so the user can still copy the link by hand.
      window.prompt('Copy this collaboration link:', link)
    }
    useToastStore.getState().addToast({
      kind: 'success',
      message: 'Collaboration link copied. Anyone with the link can edit this note live.',
    })
  }

  return (
    <button
      type="button"
      onClick={onShare}
      className="flex items-center gap-1 hover:text-obsidianText transition-colors"
      title="Copy a live-collaboration link for this note. Anyone with the link can edit it live."
      data-testid="status-bar-collab-share"
    >
      <ShareIcon className="w-3 h-3" />
      <span>Share</span>
    </button>
  )
}

// Per-note "Live" toggle for the `per-note` collaboration mode. This is the
// SINGLE control for live collaboration in per-note mode: one button that both
// flips the note live/solo AND reflects the current state (label + green dot +
// connection health), so there is no separate status badge competing with it.
// It gates the yjs connection in per-note mode (the editor only dials a room
// for a note the user has activated, keeping every other note solo + fast).
// Visible ONLY when:
//   - the transport is configured (getConfiguredUrl() non-null), AND
//   - collaborationMode === 'per-note', AND
//   - a note is open.
// In 'off' mode there's nothing to toggle; in 'repo' mode every note is live
// already so a per-note switch would be misleading — the CollabPill carries
// the status there instead (and the pill suppresses itself in per-note mode so
// the two never both show "Live: on" at once).
function LiveCollabToggle({ noteId }: { noteId: string | null }) {
  const mode = useSettingsStore(s => s.collaborationMode)
  const active = useActiveCollabStore(s => (noteId ? s.activeNoteIds.has(noteId) : false))
  const toggle = useActiveCollabStore(s => s.toggle)
  // The WebSocket probe health, so the live button can show connecting/
  // retrying/unreachable on the SAME control instead of a separate pill.
  const { status, attempts } = useCollaboration()
  const url = getConfiguredUrl()
  if (!url || !noteId || mode !== 'per-note') return null

  // When the note is OFF, the button is a plain "Go live" affordance. When it
  // is ON, the label + colour + tooltip reflect the live connection state, so
  // state is shown exactly once here rather than duplicated in a status badge.
  const label = !active
    ? 'Go live'
    : status === 'connecting'
      ? 'Live: connecting…'
      : status === 'disconnected'
        ? attempts > 0 ? `Live: retrying (${attempts}/5)` : 'Live: paused'
        : status === 'error'
          ? 'Live: unreachable'
          : 'Live: on'
  const color = !active
    ? 'hover:text-obsidianText'
    : status === 'connected'
      ? 'text-green-500'
      : status === 'error'
        ? 'text-red-400'
        : 'text-amber-400'
  const liveOn = active && status === 'connected'

  return (
    <button
      type="button"
      onClick={() => toggle(noteId)}
      className={`flex items-center gap-1 transition-colors ${color}`}
      title={active
        ? `Live collaboration is ON for this note (${label.replace(/^Live: /, '')}). Click to stop sharing edits and return to solo editing.`
        : 'Turn ON live collaboration for this note. Edits sync in real time with anyone who has its share link. Other notes stay solo.'}
      data-testid="status-bar-collab-toggle"
      aria-pressed={active}
    >
      {liveOn ? <SignalIcon className="w-3 h-3" /> : <SignalSlashIcon className="w-3 h-3" />}
      <span>{active ? 'Stop live' : 'Go live'}</span>
    </button>
  )
}

// Tiny presence pill — shows the live-collab WebSocket health when
// collaboration is connecting/connected (mode !== 'off' and a transport is
// configured). Hidden when collab is off so the footer stays uncluttered for
// the default single-user case. ALSO hidden in 'per-note' mode: there the
// LiveCollabToggle is the single control and already carries the live status,
// so showing the pill too would duplicate the "Live: on" indicator.
function CollabPill() {
  const mode = useSettingsStore(s => s.collaborationMode)
  const { status, attempts, url } = useCollaboration()
  if (status === 'off' || url == null || mode === 'per-note') return null

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
