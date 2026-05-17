'use client'

import { EyeIcon, PencilIcon, StarIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useUIStore, useNoteStore } from '@/stores'
import { extractTags } from '@/utils/tags'
import type { Note } from '@/types'

interface EditorHeaderProps {
  note: Note
  onTitleChange: (title: string) => void
}

export const EditorHeader = ({ note, onTitleChange }: EditorHeaderProps) => {
  const { isPreviewMode, togglePreview } = useUIStore()
  const { togglePinNote } = useNoteStore()

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  const wordCount = note.content.trim().split(/\s+/).filter(Boolean).length
  // Tags come from #word patterns in the body — Obsidian convention.
  const tagCount = extractTags(note.content).length

  return (
    <div className="border-b border-obsidianBorder">
      {/* Title row */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          onClick={() => togglePinNote(note.id)}
          className={`p-1.5 rounded transition-colors ${
            note.isPinned
              ? 'text-yellow-500 hover:bg-yellow-500/10'
              : 'text-obsidianSecondaryText hover:bg-obsidianHighlight'
          }`}
          title={note.isPinned ? 'Unpin note' : 'Pin note'}
        >
          {note.isPinned ? (
            <StarIconSolid className="w-5 h-5" />
          ) : (
            <StarIcon className="w-5 h-5" />
          )}
        </button>

        <input
          type="text"
          value={note.title}
          onChange={e => onTitleChange(e.target.value)}
          className="flex-1 bg-transparent text-xl font-medium text-obsidianText focus:outline-none"
          placeholder="Note title..."
        />

        <button
          onClick={togglePreview}
          className="obsidian-button"
          title={isPreviewMode ? 'Edit mode' : 'Preview mode'}
        >
          {isPreviewMode ? (
            <PencilIcon className="w-5 h-5" />
          ) : (
            <EyeIcon className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Metadata row */}
      <div className="flex items-center justify-end gap-4 px-4 py-1 text-xs text-obsidianSecondaryText border-t border-obsidianBorder/50">
        {tagCount > 0 && <span>{tagCount} tag{tagCount === 1 ? '' : 's'}</span>}
        <span>{wordCount} words</span>
        <span>Modified {formatDate(note.updatedAt)}</span>
      </div>
    </div>
  )
}

export default EditorHeader
