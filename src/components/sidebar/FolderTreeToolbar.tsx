'use client'

import {
  DocumentPlusIcon,
  FolderPlusIcon,
  ChevronDoubleDownIcon,
  ChevronDoubleUpIcon,
} from '@heroicons/react/24/outline'
import { useNoteStore, useFolderStore, useWorkspaceStore } from '@/stores'

// Thin icon-button strip above the folder tree (Obsidian-style).
// Matches the toolbar from the user's reference screenshot.
export const FolderTreeToolbar = () => {
  const { addNote } = useNoteStore()
  const { addFolder, activeFolderId, setAllFoldersExpanded } = useFolderStore()
  const openNote = useWorkspaceStore(s => s.openNote)

  const handleNewNote = () => {
    const note = addNote({ folderId: activeFolderId })
    openNote(note.id, { preview: false })
  }
  const handleNewFolder = () => {
    addFolder({ parentId: activeFolderId })
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-obsidianBorder/60">
      <ToolbarButton onClick={handleNewNote} title="New note (Ctrl+N)">
        <DocumentPlusIcon className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={handleNewFolder} title="New folder (Ctrl+Shift+N)">
        <FolderPlusIcon className="w-4 h-4" />
      </ToolbarButton>
      <div className="flex-1" />
      <ToolbarButton onClick={() => setAllFoldersExpanded(true)} title="Expand all">
        <ChevronDoubleDownIcon className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => setAllFoldersExpanded(false)} title="Collapse all">
        <ChevronDoubleUpIcon className="w-4 h-4" />
      </ToolbarButton>
    </div>
  )
}

const ToolbarButton = ({
  onClick, title, children,
}: { onClick: () => void; title: string; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    title={title}
    className="p-1.5 rounded text-obsidianSecondaryText hover:bg-obsidianDarkGray hover:text-obsidianText transition-colors"
  >
    {children}
  </button>
)

export default FolderTreeToolbar
