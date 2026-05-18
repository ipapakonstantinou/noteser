'use client'

import { extractTags } from '@/utils/tags'
import type { Note } from '@/types'

interface EditorFooterProps {
  note: Note
}

// Slim status bar at the bottom of a pane. Matches Obsidian's status-bar
// placement: word/char counts on the right, optional context on the left.
export const EditorFooter = ({ note }: EditorFooterProps) => {
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

  return (
    <div className="flex items-center justify-end gap-4 px-4 py-1 text-[11px] text-obsidianSecondaryText border-t border-obsidianBorder">
      {tagCount > 0 && <span>{tagCount} tag{tagCount === 1 ? '' : 's'}</span>}
      <span>{wordCount} word{wordCount === 1 ? '' : 's'}</span>
      <span>{charCount} char{charCount === 1 ? '' : 's'}</span>
      <span>Modified {formatDate(note.updatedAt)}</span>
    </div>
  )
}

export default EditorFooter
