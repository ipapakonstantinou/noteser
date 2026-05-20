'use client'

import { useEffect, useState } from 'react'
import {
  CloudArrowUpIcon,
  CloudArrowDownIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ArrowRightOnRectangleIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline'
import { useGitHubStore, useUIStore, useWorkspaceStore } from '@/stores'
import { useGitHubSync, useHydration } from '@/hooks'
import { SourceControlPanel } from './SourceControlPanel'

// Sidebar's GitHub panel: status, repo info, last commit, conflicts,
// and the sync action all in one place. Reuses useGitHubSync.runSync —
// no separate code path from the footer button so behaviour stays
// consistent.

function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// Re-render the relative-time labels every 60s without a full app
// refresh; keeps "5m ago" honest as the minute ticks over.
function useTick(ms = 60_000) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
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
  const conflictTabs = useWorkspaceStore(s => {
    const out: { paneId: string; tabId: string; title: string }[] = []
    for (const pane of s.panes) {
      for (const t of pane.tabs) {
        if (t.kind === 'merge-conflict') {
          out.push({ paneId: pane.id, tabId: t.id, title: t.conflict.path })
        }
      }
    }
    return out
  })
  const focusTab = useWorkspaceStore(s => s.focusTab)

  const { runSync, runPullOnly, syncState } = useGitHubSync()

  if (!hydrated || !user) {
    return (
      <div className="text-center py-8 text-obsidianSecondaryText">
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

  return (
    <div className="px-1 space-y-4">
      <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
        GitHub sync
      </h3>

      {/* Account */}
      <div className="flex items-center gap-2 text-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={user.avatar_url} alt={user.login} className="w-6 h-6 rounded-full flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-obsidianText truncate">@{user.login}</div>
          {user.name && <div className="text-[11px] text-obsidianSecondaryText truncate">{user.name}</div>}
        </div>
      </div>

      {/* Vault repo */}
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">Vault</div>
        {repo ? (
          <a
            href={`https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm text-obsidianAccentPurple hover:underline truncate"
            title="Open the repo on GitHub"
          >
            {repo.owner}/{repo.name}
            <span className="text-obsidianSecondaryText"> · {repo.branch}</span>
          </a>
        ) : (
          <button
            onClick={() => openModal({ type: 'github-repo' })}
            className="text-sm text-obsidianAccentPurple hover:underline"
          >
            Pick a vault repo
          </button>
        )}
      </div>

      {/* Last sync */}
      {repo && (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">Last sync</div>
          {lastSyncedAt ? (
            <div className="text-sm text-obsidianText">
              {relativeTime(lastSyncedAt)}
              {lastCommitSha && (
                <a
                  href={`https://github.com/${repo.owner}/${repo.name}/commit/${lastCommitSha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-[11px] text-obsidianSecondaryText hover:text-obsidianAccentPurple"
                  title="Open the commit on GitHub"
                >
                  {lastCommitSha.slice(0, 7)}
                </a>
              )}
            </div>
          ) : (
            <div className="text-sm text-obsidianSecondaryText italic">never</div>
          )}
        </div>
      )}

      {/* Source-control panel (vsg1) — VS Code-style pending-changes list.
          Sits between "Last sync" and the conflicts box so the user sees
          what's about to go up BEFORE they hit Sync. */}
      {repo && <SourceControlPanel />}

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

      {/* Sync action */}
      {repo && (
        <div className="space-y-1.5">
          <button
            onClick={runSync}
            disabled={syncState.kind === 'running'}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-obsidianAccentPurple text-white text-sm hover:opacity-90 disabled:opacity-60"
          >
            {syncState.kind === 'running' ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : syncState.kind === 'ok' ? (
              <CheckCircleIcon className="w-4 h-4" />
            ) : syncState.kind === 'err' ? (
              <ExclamationCircleIcon className="w-4 h-4" />
            ) : (
              <CloudArrowUpIcon className="w-4 h-4" />
            )}
            <span className="flex-1 text-left truncate">
              {syncState.kind === 'running' && 'Syncing…'}
              {syncState.kind === 'ok' && syncState.message}
              {syncState.kind === 'err' && syncState.message}
              {syncState.kind === 'idle' && 'Sync now'}
            </span>
            {syncState.kind === 'ok' && syncState.url && (
              <a
                href={syncState.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] underline opacity-80 hover:opacity-100"
              >
                view
              </a>
            )}
          </button>
          {/* Secondary: one-way pull. Same disabled rule as primary —
              the shared isSyncing guard means either action blocks the
              other anyway, but disabling the button here gives clearer
              visual feedback. */}
          <button
            onClick={runPullOnly}
            disabled={syncState.kind === 'running'}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded border border-obsidianBorder bg-transparent text-obsidianText text-xs hover:bg-obsidianDarkGray disabled:opacity-60"
            title="Fetch and apply remote changes without uploading local edits"
          >
            <CloudArrowDownIcon className="w-4 h-4" />
            <span className="flex-1 text-left">Pull only</span>
          </button>
        </div>
      )}

      {/* Pick / switch repo */}
      {repo && (
        <button
          onClick={() => openModal({ type: 'github-repo' })}
          className="w-full text-xs text-obsidianSecondaryText hover:text-obsidianText"
        >
          Change vault repo
        </button>
      )}

      {/* Disconnect */}
      <div className="pt-3 border-t border-obsidianBorder">
        <button
          onClick={() => {
            if (confirm('Disconnect from GitHub? Your local notes stay in this browser; the connection token is removed.')) {
              disconnect()
            }
          }}
          className="w-full flex items-center justify-center gap-2 text-xs text-obsidianSecondaryText hover:text-red-400"
        >
          <ArrowRightOnRectangleIcon className="w-4 h-4" />
          Disconnect from GitHub
        </button>
      </div>
    </div>
  )
}

export default GitHubView
