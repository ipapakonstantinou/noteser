'use client'

import { extractTags } from '@/utils/tags'
import { useGitHubStore } from '@/stores'
import type { Note } from '@/types'

interface EditorFooterProps {
  note: Note
}

// Slim status bar at the bottom of a pane. Matches Obsidian's status-bar
// placement: sync/branch context on the left, counts on the right.
export const EditorFooter = ({ note }: EditorFooterProps) => {
  const { syncRepo, lastSyncedAt } = useGitHubStore()

  const tagCount = extractTags(note.content).length
  const wordCount = note.content.trim().split(/\s+/).filter(Boolean).length
  const charCount = note.content.length

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
    <div className="flex items-center justify-between gap-4 px-4 py-1 text-[11px] text-obsidianSecondaryText border-t border-obsidianBorder">
      <div className="flex items-center gap-3 truncate">
        {syncRepo && (
          <>
            <span className="truncate" title={`${syncRepo.owner}/${syncRepo.name}`}>
              {syncRepo.owner}/{syncRepo.name}
            </span>
            <span className="text-obsidianBorder">·</span>
            <span>{syncRepo.branch}</span>
            <span className="text-obsidianBorder">·</span>
            <span>{syncLabel}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {tagCount > 0 && <span>{tagCount} tag{tagCount === 1 ? '' : 's'}</span>}
        <span>{wordCount} word{wordCount === 1 ? '' : 's'}</span>
        <span>{charCount} char{charCount === 1 ? '' : 's'}</span>
        <span>Modified {formatDate(note.updatedAt)}</span>
      </div>
    </div>
  )
}

export default EditorFooter
