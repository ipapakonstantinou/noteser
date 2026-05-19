'use client'

import { useEffect, useState } from 'react'
import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  CodeBracketIcon,
  CloudArrowUpIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useGitHubStore } from '@/stores'
import { useGitHubSync } from '@/hooks/useGitHubSync'
import { SYNC_REQUEST_EVENT } from '@/utils/events'

function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
import { useHydration } from '@/hooks'
import { FolderTree } from './FolderTree'
import { FolderTreeToolbar } from './FolderTreeToolbar'
import { CalendarView } from './CalendarView'
import { GitHubView } from './GitHubView'
import { OutlineView } from './OutlineView'
import { BacklinksView } from './BacklinksView'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuState } from '@/types'

export const Sidebar = () => {
  const hydrated = useHydration()
  const {
    sidebarCollapsed,
    toggleSidebar,
    currentView,
    openModal,
  } = useUIStore()

  const githubUser = useGitHubStore((s) => s.user)
  const githubSyncRepo = useGitHubStore((s) => s.syncRepo)
  const githubLastSyncedAt = useGitHubStore((s) => s.lastSyncedAt)
  const { syncState, runSync } = useGitHubSync()

  // Auto-rerun sync after the conflict modal applies resolutions, so the
  // user doesn't have to click Sync a second time.
  useEffect(() => {
    const handler = () => { runSync() }
    window.addEventListener(SYNC_REQUEST_EVENT, handler)
    return () => window.removeEventListener(SYNC_REQUEST_EVENT, handler)
  }, [runSync])

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  const handleRightClick = (e: React.MouseEvent, type: 'note' | 'folder', id: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type, id })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  return (
    <div
      className={`obsidian-sidebar h-full overflow-hidden flex flex-col transition-all duration-300 ${
        sidebarCollapsed ? 'w-[50px]' : 'w-64'
      }`}
      onClick={closeContextMenu}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-obsidianBorder">
        {!sidebarCollapsed && (
          <h1 className="text-lg font-semibold text-obsidianText">Noteser</h1>
        )}
        <button
          className="obsidian-button"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronDoubleRightIcon className="w-4 h-4" />
          ) : (
            <ChevronDoubleLeftIcon className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Folder-tree toolbar (only for the notes view; calendar has its
          own controls). */}
      {!sidebarCollapsed && currentView === 'notes' && <FolderTreeToolbar />}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!sidebarCollapsed && (
          currentView === 'calendar' ? <CalendarView /> :
          currentView === 'github' ? <GitHubView /> :
          currentView === 'outline' ? <OutlineView /> :
          currentView === 'backlinks' ? <BacklinksView /> :
          <FolderTree onRightClick={handleRightClick} />
        )}
      </div>

      {/* Footer */}
      {!sidebarCollapsed && (
        <div className="px-2 py-2 border-t border-obsidianBorder space-y-1">
          {hydrated && githubUser ? (
            <>
              <button
                onClick={() => openModal({ type: 'github-repo' })}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-obsidianSecondaryText hover:bg-obsidianDarkGray transition-colors"
                title={
                  githubSyncRepo
                    ? `Vault: ${githubSyncRepo.owner}/${githubSyncRepo.name} — click to change`
                    : `Connected as @${githubUser.login} — click to pick a vault repo`
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={githubUser.avatar_url}
                  alt={githubUser.login}
                  className="w-4 h-4 rounded-full flex-shrink-0"
                />
                <span className="truncate">
                  {githubSyncRepo
                    ? `${githubSyncRepo.owner}/${githubSyncRepo.name}`
                    : 'Pick a vault repo'}
                </span>
              </button>
              {githubSyncRepo && (
                <button
                  onClick={runSync}
                  disabled={syncState.kind === 'running'}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-obsidianSecondaryText hover:bg-obsidianDarkGray transition-colors disabled:opacity-60"
                  title={syncState.kind === 'err' ? syncState.message : 'Commit and push current notes'}
                >
                  {syncState.kind === 'running' ? (
                    <div className="w-4 h-4 border-2 border-obsidianAccentPurple border-t-transparent rounded-full animate-spin" />
                  ) : syncState.kind === 'ok' ? (
                    <CheckCircleIcon className="w-4 h-4 text-green-500" />
                  ) : syncState.kind === 'err' ? (
                    <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
                  ) : (
                    <CloudArrowUpIcon className="w-4 h-4" />
                  )}
                  <span className="truncate">
                    {syncState.kind === 'running' && 'Syncing…'}
                    {syncState.kind === 'ok' && syncState.message}
                    {syncState.kind === 'err' && syncState.message}
                    {syncState.kind === 'idle' && (
                      githubLastSyncedAt
                        ? `Sync · ${relativeTime(githubLastSyncedAt)}`
                        : 'Commit & Sync'
                    )}
                  </span>
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => openModal({ type: 'github-auth' })}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-obsidianSecondaryText hover:bg-obsidianDarkGray transition-colors"
              title="Connect to GitHub"
            >
              <CodeBracketIcon className="w-4 h-4" />
              Connect to GitHub
            </button>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          contextMenu={contextMenu}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}

export default Sidebar
