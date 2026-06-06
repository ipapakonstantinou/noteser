'use client'

import { EyeIcon, PencilIcon, StarIcon, ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useUIStore, useNoteStore, useFolderStore, useWorkspaceStore } from '@/stores'
import { canGoBack as histCanGoBack, canGoForward as histCanGoForward } from '@/utils/navHistory'
import { useViewport } from '@/hooks'
import { sanitizeTitleInput } from '@/utils/sanitizeFilename'
import type { Note } from '@/types'

interface EditorHeaderProps {
  note: Note
  paneId: string
  onTitleChange: (title: string) => void
}

export const EditorHeader = ({ note, paneId, onTitleChange }: EditorHeaderProps) => {
  const { isPreviewMode, togglePreview } = useUIStore()
  const setCurrentView = useUIStore(s => s.setCurrentView)
  const sidebarCollapsed = useUIStore(s => s.sidebarCollapsed)
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  const { togglePinNote } = useNoteStore()
  const { getFolderById } = useFolderStore()
  const setActiveFolder = useFolderStore(s => s.setActiveFolder)
  const setFolderExpanded = useFolderStore(s => s.setFolderExpanded)
  const { isMobile } = useViewport()
  const goBack = useWorkspaceStore(s => s.goBack)
  const goForward = useWorkspaceStore(s => s.goForward)
  // Subscribe to this pane's history so the arrows re-evaluate their
  // enabled state whenever navigation changes it.
  const history = useWorkspaceStore(s => s.histories[paneId])
  const canBack = !!history && histCanGoBack(history)
  const canForward = !!history && histCanGoForward(history)

  // Aggressive mobile mode (per user feedback on the Phase B build):
  // hide the entire editor header on mobile — the tab strip already
  // shows the title, MobileTopBar carries the preview toggle, and the
  // overflow menu surfaces pin + rename. Reclaims ~58px of vertical
  // space on a 375px viewport.
  if (isMobile) return null

  // Build a "Folder / Subfolder" trail by walking parentId chain. Empty when
  // the note is at the root (no folder). We keep id alongside name so the
  // breadcrumb segments can navigate the sidebar.
  const folderTrail: { id: string; name: string }[] = []
  let current = note.folderId ? getFolderById(note.folderId) : undefined
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    folderTrail.unshift({ id: current.id, name: current.name })
    seen.add(current.id)
    current = current.parentId ? getFolderById(current.parentId) : undefined
  }

  // Reveal a folder in the sidebar: switch to the Files view, open the
  // sidebar if it was collapsed, expand the chain leading to the folder,
  // and select the folder so the user immediately sees their context.
  const revealFolder = (folderId: string) => {
    if (sidebarCollapsed) toggleSidebar()
    setCurrentView('notes')
    let walk = getFolderById(folderId)
    const walked = new Set<string>()
    while (walk && !walked.has(walk.id)) {
      setFolderExpanded(walk.id, true)
      walked.add(walk.id)
      walk = walk.parentId ? getFolderById(walk.parentId) : undefined
    }
    setActiveFolder(folderId)
  }

  return (
    <div className="flex flex-col border-b border-obsidianBorder">
      {folderTrail.length > 0 && (
        <div className="flex items-center gap-1 px-4 pt-2 text-[11px] text-obsidianSecondaryText truncate">
          {folderTrail.map((seg, i) => (
            <span key={seg.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => revealFolder(seg.id)}
                className="truncate hover:text-obsidianText hover:underline transition-colors"
                title={`Reveal ${seg.name} in the file tree`}
                data-testid={`breadcrumb-folder-${i}`}
              >
                {seg.name}
              </button>
              <span className="text-obsidianBorder">/</span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => {
              const parentId = folderTrail[folderTrail.length - 1]?.id
              if (parentId) revealFolder(parentId)
            }}
            className="truncate text-obsidianText/70 hover:text-obsidianText hover:underline transition-colors"
            title="Reveal this note in the file tree"
            data-testid="breadcrumb-note"
          >
            {note.title || 'Untitled'}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-3">
      {/* Obsidian-style Back / Forward through this pane's note history.
          Disabled at the ends. Alt+Left / Alt+Right + mouse buttons
          3/4 trigger the same actions (wired globally in page.tsx). */}
      <button
        onClick={() => goBack(paneId)}
        disabled={!canBack}
        className="p-1.5 rounded transition-colors inline-flex items-center justify-center text-obsidianSecondaryText enabled:hover:bg-obsidianHighlight disabled:opacity-30 disabled:cursor-default"
        title="Back (Alt+←)"
        aria-label="Navigate back"
        data-testid="nav-back"
      >
        <ArrowLeftIcon className="w-5 h-5" />
      </button>
      <button
        onClick={() => goForward(paneId)}
        disabled={!canForward}
        className="p-1.5 rounded transition-colors inline-flex items-center justify-center text-obsidianSecondaryText enabled:hover:bg-obsidianHighlight disabled:opacity-30 disabled:cursor-default"
        title="Forward (Alt+→)"
        aria-label="Navigate forward"
        data-testid="nav-forward"
      >
        <ArrowRightIcon className="w-5 h-5" />
      </button>

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
