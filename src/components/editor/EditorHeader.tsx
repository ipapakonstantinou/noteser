'use client'

import { EyeIcon, PencilIcon, StarIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useUIStore, useNoteStore, useFolderStore } from '@/stores'
import { useViewport } from '@/hooks'
import { sanitizeTitleInput } from '@/utils/sanitizeFilename'
import type { Note } from '@/types'

interface EditorHeaderProps {
  note: Note
  onTitleChange: (title: string) => void
}

export const EditorHeader = ({ note, onTitleChange }: EditorHeaderProps) => {
  const { isPreviewMode, togglePreview } = useUIStore()
  const { togglePinNote } = useNoteStore()
  const { getFolderById } = useFolderStore()
  const { isMobile } = useViewport()

  // Aggressive mobile mode (per user feedback on the Phase B build):
  // hide the entire editor header on mobile — the tab strip already
  // shows the title, MobileTopBar carries the preview toggle, and the
  // overflow menu surfaces pin + rename. Reclaims ~58px of vertical
  // space on a 375px viewport.
  if (isMobile) return null

  // Build a "Folder / Subfolder" trail by walking parentId chain. Empty when
  // the note is at the root (no folder).
  const folderTrail: string[] = []
  let current = note.folderId ? getFolderById(note.folderId) : undefined
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    folderTrail.unshift(current.name)
    seen.add(current.id)
    current = current.parentId ? getFolderById(current.parentId) : undefined
  }

  return (
    <div className="flex flex-col border-b border-obsidianBorder">
      {folderTrail.length > 0 && (
        <div className="flex items-center gap-1 px-4 pt-2 text-[11px] text-obsidianSecondaryText truncate">
          {folderTrail.map((name, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="truncate">{name}</span>
              <span className="text-obsidianBorder">/</span>
            </span>
          ))}
          <span className="truncate text-obsidianText/70">{note.title || 'Untitled'}</span>
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-3">
      <button
        onClick={() => togglePinNote(note.id)}
        className={`p-1.5 max-md:p-2.5 rounded transition-colors inline-flex items-center justify-center max-md:min-w-[44px] max-md:min-h-[44px] ${
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
        title="Title may only contain letters, digits, spaces, and - _ . ( )"
      />

      {/* Preview/edit toggle. Hidden on mobile because MobileTopBar
          carries the same control — two pencils side-by-side is just
          noise on a 375px viewport. (Spotted in user-supplied screenshot
          of the Phase B mobile build.) */}
      <button
        onClick={togglePreview}
        className="obsidian-button max-md:hidden md:p-2.5 md:min-w-[44px] md:min-h-[44px] md:inline-flex md:items-center md:justify-center"
        title={isPreviewMode ? 'Edit mode' : 'Preview mode'}
        data-testid="editor-header-preview-toggle"
      >
        {isPreviewMode ? (
          <PencilIcon className="w-5 h-5" />
        ) : (
          <EyeIcon className="w-5 h-5" />
        )}
      </button>
      </div>
    </div>
  )
}

export default EditorHeader
