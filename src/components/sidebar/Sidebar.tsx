'use client'

import { useCallback, useState } from 'react'
import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  PlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ClockIcon,
  TagIcon,
  DocumentDuplicateIcon,
  Cog6ToothIcon,
  CalendarDaysIcon,
  CodeBracketIcon,
  CloudArrowUpIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'
import { useUIStore, useNoteStore, useFolderStore, useGitHubStore, useTagStore } from '@/stores'
import { syncToGitHub } from '@/utils/githubSync'

function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
import { useHydration } from '@/hooks'
import { FolderTree } from './FolderTree'
import { CalendarView } from './CalendarView'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuState } from '@/types'

export const Sidebar = () => {
  const hydrated = useHydration()
  const {
    sidebarCollapsed,
    toggleSidebar,
    currentView,
    setCurrentView,
    openSearch,
    openModal
  } = useUIStore()

  const { addNote, getDeletedNotes, getRecentNotes, getPinnedNotes } = useNoteStore()
  const { addFolder, activeFolderId } = useFolderStore()
  const githubToken = useGitHubStore((s) => s.token)
  const githubUser = useGitHubStore((s) => s.user)
  const githubSyncRepo = useGitHubStore((s) => s.syncRepo)
  const githubLastSyncedAt = useGitHubStore((s) => s.lastSyncedAt)
  const recordSync = useGitHubStore((s) => s.recordSync)

  // Sync state — local to the sidebar, no need to persist.
  type SyncState =
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'ok'; message: string; url: string | null }
    | { kind: 'err'; message: string }
  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' })

  const runSync = useCallback(async () => {
    if (!githubToken || !githubSyncRepo) return
    setSyncState({ kind: 'running' })
    try {
      const { notes, updateNote } = useNoteStore.getState()
      const { folders } = useFolderStore.getState()
      const { tags } = useTagStore.getState()
      const { result, pathUpdates } = await syncToGitHub({
        token: githubToken,
        repo: githubSyncRepo,
        notes,
        folders,
        tags: tags.map(t => ({ id: t.id, name: t.name })),
      })
      // Apply path updates to the note store.
      for (const u of pathUpdates) updateNote(u.noteId, { gitPath: u.gitPath })
      recordSync(result.commitSha)
      if (result.unchanged) {
        setSyncState({ kind: 'ok', message: 'Up to date', url: null })
      } else {
        const parts: string[] = []
        if (result.created) parts.push(`${result.created} new`)
        if (result.updated) parts.push(`${result.updated} updated`)
        if (result.deleted) parts.push(`${result.deleted} deleted`)
        setSyncState({ kind: 'ok', message: parts.join(' · '), url: result.commitUrl })
      }
      // Clear the success badge after a moment so the row returns to its
      // "last synced X ago" steady state.
      setTimeout(() => setSyncState({ kind: 'idle' }), 5000)
    } catch (err) {
      setSyncState({ kind: 'err', message: err instanceof Error ? err.message : 'Sync failed' })
    }
  }, [githubToken, githubSyncRepo, recordSync])

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  // Use default values during SSR/hydration to avoid mismatch
  const deletedNotes = hydrated ? getDeletedNotes() : []
  const recentNotes = hydrated ? getRecentNotes(5) : []
  const pinnedNotes = hydrated ? getPinnedNotes() : []

  const handleAddNote = () => {
    addNote({ folderId: activeFolderId })
  }

  const handleAddFolder = () => {
    addFolder()
  }

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

      {/* Actions */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-obsidianBorder">
        {sidebarCollapsed ? (
          <button
            className="obsidian-button w-full"
            onClick={handleAddNote}
            title="New note"
          >
            <PlusIcon className="w-5 h-5" />
          </button>
        ) : (
          <>
            <button
              className="obsidian-button flex-1 flex items-center justify-center gap-1"
              onClick={openSearch}
              title="Search (Ctrl+K)"
            >
              <MagnifyingGlassIcon className="w-4 h-4" />
              <span className="text-xs">Search</span>
            </button>
            <button
              className="obsidian-button"
              onClick={handleAddNote}
              title="New note (Ctrl+N)"
            >
              <PlusIcon className="w-5 h-5" />
            </button>
            <button
              className="obsidian-button"
              onClick={handleAddFolder}
              title="New folder (Ctrl+Shift+N)"
            >
              <FolderPlusIcon className="w-5 h-5" />
            </button>
            <button
              className="obsidian-button"
              onClick={() => openModal({ type: 'template' })}
              title="New from template"
            >
              <DocumentDuplicateIcon className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      {!sidebarCollapsed && (
        <div className="px-2 py-2 border-b border-obsidianBorder space-y-1">
          <button
            onClick={() => setCurrentView('notes')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'notes'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <DocumentDuplicateIcon className="w-4 h-4" />
            All Notes
          </button>
          <button
            onClick={() => setCurrentView('recent')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'recent'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <ClockIcon className="w-4 h-4" />
            Recent
            {recentNotes.length > 0 && (
              <span className="ml-auto text-xs text-obsidianSecondaryText">
                {recentNotes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setCurrentView('tags')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'tags'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <TagIcon className="w-4 h-4" />
            Tags
          </button>
          <button
            onClick={() => setCurrentView('trash')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'trash'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <TrashIcon className="w-4 h-4" />
            Trash
            {deletedNotes.length > 0 && (
              <span className="ml-auto text-xs text-obsidianSecondaryText">
                {deletedNotes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setCurrentView('calendar')}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'calendar'
                ? 'bg-obsidianHighlight text-obsidianText'
                : 'text-obsidianSecondaryText hover:bg-obsidianDarkGray'
            }`}
          >
            <CalendarDaysIcon className="w-4 h-4" />
            Calendar
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!sidebarCollapsed && (
          currentView === 'calendar'
            ? <CalendarView />
            : <FolderTree onRightClick={handleRightClick} />
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
          <button
            onClick={() => openModal({ type: 'export' })}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-obsidianSecondaryText hover:bg-obsidianDarkGray transition-colors"
          >
            <Cog6ToothIcon className="w-4 h-4" />
            Export Notes
          </button>
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
