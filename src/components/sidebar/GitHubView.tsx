'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowRightOnRectangleIcon,
  Cog6ToothIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  CloudArrowUpIcon,
  CodeBracketIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { useGitHubStore, useUIStore, useWorkspaceStore, useSettingsStore } from '@/stores'
import { useGitHubSync, useHydration } from '@/hooks'
import { SourceControlPanel } from './SourceControlPanel'

// Obsidian-git styled Source Control panel (vscg).
// Layout:
//   - Action toolbar (Sync / Pull / Refresh / Open repo / Settings)
//   - Optional commit-message input ({{date}} template substituted)
//   - CHANGES collapsible group → SourceControlPanel
//   - Conflicts block (when non-empty)
//   - Repo metadata footer
//
// Note: noteser's sync model is single-action ("Commit & Sync") — there
// is no staging step. The toolbar mirrors obsidian-git's icons but
// "Stage all" / "Discard" aren't surfaced because every pending change
// is included in every push.

function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function useTick(ms = 60_000) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

// Substitute {{date}} → today (YYYY-MM-DD) so users can save a stable
// commit-message template and have it interpolated at commit time.
// Other tokens left as-is; future-extensible if we want {{count}} etc.
function expandCommitMessage(raw: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return raw.replace(/\{\{date\}\}/g, today)
}

export const GitHubView = () => {
  const hydrated = useHydration()
  useTick()

  const user = useGitHubStore(s => s.user)
  const repo = useGitHubStore(s => s.syncRepo)
  const lastSyncedAt = useGitHubStore(s => s.lastSyncedAt)
  const lastCommitSha = useGitHubStore(s => s.lastCommitSha)
  const disconnect = useGitHubStore(s => s.disconnect)
  const openModal = useUIStore(s => s.openModal)

  const panes = useWorkspaceStore(s => s.panes)
  const conflictTabs = useMemo(() => {
    const out: { paneId: string; tabId: string; title: string }[] = []
    for (const pane of panes) {
      for (const t of pane.tabs) {
        if (t.kind === 'merge-conflict') {
          out.push({ paneId: pane.id, tabId: t.id, title: t.conflict.path })
        }
      }
    }
    return out
  }, [panes])
  const focusTab = useWorkspaceStore(s => s.focusTab)

  const { runSync, runPullOnly, syncState } = useGitHubSync()
  // Default commit-message template — vault-synced via settingsStore.
  // Users edit it in Settings → GitHub sync. Supports {{date}} →
  // today's YYYY-MM-DD via `expandCommitMessage` below.
  const defaultCommitMessage = useSettingsStore(s => s.defaultCommitMessage)

  const [commitMsg, setCommitMsg] = useState('')
  const [changesExpanded, setChangesExpanded] = useState(true)

  // Seed the input with the configured template on mount + whenever
  // the template changes (e.g. user edited it in Settings while this
  // view was mounted but unused). Only seeds when the input is empty
  // so we don't clobber an in-progress draft.
  useEffect(() => {
    if (!commitMsg) setCommitMsg(defaultCommitMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCommitMessage])

  // Not connected → minimal CTA.
  if (!hydrated || !user) {
    return (
      <div className="text-center px-3 py-8 text-obsidianSecondaryText">
        <p className="text-sm">Not connected to GitHub.</p>
        <button
          onClick={() => openModal({ type: 'github-auth' })}
          className="mt-3 inline-flex items-center gap-2 text-sm text-obsidianAccentPurple hover:underline"
        >
          <CodeBracketIcon className="w-4 h-4" />
          Connect to GitHub
        </button>
      </div>
    )
  }

  const isSyncing = syncState.kind === 'running'

  const onSyncClick = () => {
    const msg = expandCommitMessage(commitMsg.trim())
    runSync(msg || undefined)
    setCommitMsg('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Action toolbar */}
      {repo ? (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-obsidianBorder">
          <ToolbarButton
            onClick={onSyncClick}
            disabled={isSyncing}
            title="Commit & sync (push local changes, pull remote)"
            testId="scm-sync"
          >
            {isSyncing ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin text-obsidianAccentPurple" />
            ) : syncState.kind === 'ok' ? (
              <CheckCircleIcon className="w-4 h-4 text-green-500" />
            ) : syncState.kind === 'err' ? (
              <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
            ) : (
              <CloudArrowUpIcon className="w-4 h-4" />
            )}
          </ToolbarButton>
          <ToolbarButton
            onClick={runPullOnly}
            disabled={isSyncing}
            title="Pull only (fetch and apply remote changes)"
            testId="scm-pull"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => runSync()}
            disabled={isSyncing}
            title="Refresh"
            testId="scm-refresh"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </ToolbarButton>
          <a
            href={`https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open repo on GitHub"
            className="p-1.5 rounded text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText transition-colors"
            data-testid="scm-open-repo"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
          </a>
          <ToolbarButton
            onClick={() => openModal({ type: 'github-repo' })}
            title="Change vault repo"
            testId="scm-settings"
          >
            <Cog6ToothIcon className="w-4 h-4" />
          </ToolbarButton>
        </div>
      ) : null}

      {/* Commit message + sync button */}
      {repo && (
        <div className="px-2 py-2 border-b border-obsidianBorder space-y-1.5">
          <textarea
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Message (Ctrl+Enter to commit)"
            rows={2}
            data-testid="scm-message"
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                onSyncClick()
              }
            }}
            className="w-full px-2 py-1 text-sm bg-obsidianDarkGray border border-obsidianBorder rounded text-obsidianText placeholder-obsidianSecondaryText focus:outline-none focus:border-obsidianAccentPurple resize-none"
          />
          <button
            onClick={onSyncClick}
            disabled={isSyncing}
            data-testid="scm-commit-button"
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-obsidianAccentPurple text-white text-sm hover:opacity-90 disabled:opacity-60"
          >
            <ArrowUpTrayIcon className="w-4 h-4" />
            <span>
              {isSyncing
                ? 'Syncing…'
                : (syncState.kind === 'err' ? syncState.message : 'Commit & Sync')}
            </span>
          </button>
        </div>
      )}

      {/* CHANGES group + conflicts + footer */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3">
        {repo && (
          <div>
            <button
              type="button"
              onClick={() => setChangesExpanded(v => !v)}
              className="w-full flex items-center gap-1 text-[11px] uppercase tracking-wide text-obsidianSecondaryText hover:text-obsidianText"
              aria-expanded={changesExpanded}
            >
              {changesExpanded ? (
                <ChevronDownIcon className="w-3 h-3" />
              ) : (
                <ChevronRightIcon className="w-3 h-3" />
              )}
              <span>Changes</span>
            </button>
            {changesExpanded && (
              <div className="mt-1.5">
                <SourceControlPanel />
              </div>
            )}
          </div>
        )}

        {/* Conflicts */}
        {conflictTabs.length > 0 && (
          <div className="space-y-2 rounded border border-yellow-700/40 bg-yellow-900/10 px-2 py-2">
            <div className="flex items-center gap-2 text-sm text-yellow-300">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
              {conflictTabs.length} conflict{conflictTabs.length === 1 ? '' : 's'} need review
            </div>
            <ul className="space-y-0.5">
              {conflictTabs.map(c => (
                <li key={c.tabId}>
                  <button
                    onClick={() => focusTab(c.tabId)}
                    className="w-full text-left text-xs text-obsidianText hover:text-obsidianAccentPurple truncate px-1 py-0.5 rounded hover:bg-obsidianDarkGray"
                    title={c.title}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Repo metadata footer */}
        {repo && (
          <div className="pt-2 mt-2 border-t border-obsidianBorder space-y-1 text-[11px] text-obsidianSecondaryText">
            <div className="flex items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={user.avatar_url} alt={user.login} className="w-3.5 h-3.5 rounded-full flex-shrink-0" />
              <span className="truncate">@{user.login}</span>
            </div>
            <div className="truncate">
              {repo.owner}/{repo.name}
              <span> · </span>
              {repo.branch}
            </div>
            {lastSyncedAt && (
              <div>
                Last sync: {relativeTime(lastSyncedAt)}
                {lastCommitSha && (
                  <a
                    href={`https://github.com/${repo.owner}/${repo.name}/commit/${lastCommitSha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 hover:text-obsidianAccentPurple"
                    title="Open the commit on GitHub"
                  >
                    ({lastCommitSha.slice(0, 7)})
                  </a>
                )}
              </div>
            )}
            <button
              onClick={() => {
                if (confirm('Disconnect from GitHub? Your local notes stay in this browser; the connection token is removed.')) {
                  disconnect()
                }
              }}
              className="flex items-center gap-1 hover:text-red-400"
            >
              <ArrowRightOnRectangleIcon className="w-3 h-3" />
              Disconnect
            </button>
          </div>
        )}

        {!repo && (
          <button
            onClick={() => openModal({ type: 'github-repo' })}
            className="w-full text-center text-sm text-obsidianAccentPurple hover:underline py-2"
          >
            Pick a vault repo to start syncing
          </button>
        )}
      </div>
    </div>
  )
}

// Compact icon-only button used in the SCM action toolbar.
const ToolbarButton = ({
  onClick, disabled, title, testId, children,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  testId?: string
  children: React.ReactNode
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    data-testid={testId}
    className="p-1.5 rounded text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  >
    {children}
  </button>
)

export default GitHubView
