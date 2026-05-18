'use client'

import { EyeIcon, PencilIcon, StarIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useUIStore, useNoteStore } from '@/stores'
import { sanitizeTitleInput } from '@/utils/export'
import type { Note } from '@/types'

interface EditorHeaderProps {
  note: Note
  onTitleChange: (title: string) => void
}

export const EditorHeader = ({ note, onTitleChange }: EditorHeaderProps) => {
  const { isPreviewMode, togglePreview } = useUIStore()
  const { togglePinNote } = useNoteStore()

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-obsidianBorder">
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
        // Strip filesystem-unsafe chars at the keystroke so the title can be
        // round-tripped to a .md filename without surprises.
        onChange={e => onTitleChange(sanitizeTitleInput(e.target.value))}
        className="flex-1 bg-transparent text-xl font-medium text-obsidianText focus:outline-none"
        placeholder="Note title..."
        title='Filenames cannot contain &lt; &gt; : " / \ | ? *'
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
  )
}

export default EditorHeader
