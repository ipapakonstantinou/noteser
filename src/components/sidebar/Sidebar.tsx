'use client'

import { useEffect, useRef, useState } from 'react'
import {
  XMarkIcon,
  CodeBracketIcon,
  CloudArrowUpIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'
import { PanelLeftIcon } from '@/components/ui'
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
import { useHydration, useViewport } from '@/hooks'
import { SidebarStack } from './SidebarStack'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuState } from '@/types'

export const Sidebar = () => {
  const hydrated = useHydration()
  const {
    sidebarCollapsed,
    toggleSidebar,
    openModal,
  } = useUIStore()

  const githubUser = useGitHubStore((s) => s.user)
  const githubSyncRepo = useGitHubStore((s) => s.syncRepo)
  const githubLastSyncedAt = useGitHubStore((s) => s.lastSyncedAt)
  const { syncState, runSync } = useGitHubSync()
  const { isMobile } = useViewport()

  // On the first mount in a mobile viewport, collapse the sidebar by
  // default — phones lose half the screen otherwise. On mobile this also
  // means the off-canvas drawer starts CLOSED on each fresh visit, which
  // is what users expect (the editor is the headline content). We only
  // auto-collapse ONCE per session so the user's manual toggle isn't fought.
  const autoCollapsedOnceRef = useRef(false)
  useEffect(() => {
    if (!isMobile || autoCollapsedOnceRef.current) return
    autoCollapsedOnceRef.current = true
    if (!sidebarCollapsed) toggleSidebar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile])

  // Mobile: render the sidebar at full drawer width (its parent in
  // page.tsx is a fixed-position container sized to min(280px, 85vw)).
  // The `sidebarCollapsed` flag on mobile is repurposed as drawer-open
  // state on the parent container, so the inner sidebar always renders
  // its "expanded" content here.
  const isExpanded = isMobile ? true : !sidebarCollapsed

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
    // Stop the event from bubbling to any ancestor onContextMenu (e.g.
    // SidebarSection's content wrapper when a panel is rendered
    // headerless inside a pinned group). Without this, right-clicking
    // a note/folder inside a pinned Files panel could trigger the
    // panel's unpin handler.
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, type, id })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  return (
    <div
      className={`obsidian-sidebar h-full overflow-hidden flex flex-col transition-all duration-300 ${
        isMobile ? 'w-full' : sidebarCollapsed ? 'w-[50px]' : 'w-64'
      }`}
      onClick={closeContextMenu}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-obsidianBorder">
        {isExpanded && (
          <h1 className="text-lg font-semibold text-obsidianText">Noteser</h1>
        )}
        <button
          className="obsidian-button"
          onClick={toggleSidebar}
          title={
            isMobile
              ? 'Close sidebar'
              : sidebarCollapsed
                ? 'Expand sidebar'
                : 'Collapse sidebar'
          }
        >
          {/* Obsidian-style panel-toggle icon — a rectangle with the
              "left edge" bar indicating the sidebar slides leftward.
              On mobile the same button closes the drawer, so we swap
              in an X glyph there for clearer intent. */}
          {isMobile
            ? <XMarkIcon className="w-4 h-4" />
            : <PanelLeftIcon className="w-4 h-4" />}
        </button>
      </div>

      {/* Content. Both mobile + desktop render the full SidebarStack
          now. Phase B originally simplified the mobile drawer to a
          files-only tree to save touch real estate, but that hid
          Calendar / Source Control / etc. behind the top-bar
          overflow menu — which the drawer overlay covers, making
          them effectively unreachable while the drawer is open.
          Surfacing the tab strip inside the drawer is the bridge.
          The icons are 4×4 with py-1.5 padding so the touch targets
          are still ≥36px tall on phone widths. */}
      {isExpanded && <SidebarStack onRightClick={handleRightClick} />}

      {/* Footer */}
      {isExpanded && (
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
                {githubUser.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={githubUser.avatar_url}
                    alt={githubUser.login}
                    className="w-4 h-4 rounded-full flex-shrink-0"
                  />
                )}
                <span className="truncate">
                  {githubSyncRepo
                    ? `${githubSyncRepo.owner}/${githubSyncRepo.name}`
                    : 'Pick a vault repo'}
                </span>
              </button>
              {githubSyncRepo && (
                <button
                  onClick={() => runSync()}
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
