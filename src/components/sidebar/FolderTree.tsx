'use client'

import { useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useNoteStore, useFolderStore, useUIStore, useTagStore, useWorkspaceStore } from '@/stores'
import { useHydration } from '@/hooks'
import { EditableText } from '../shared/EditableText'
import { Badge } from '../ui'

interface FolderTreeProps {
  onRightClick: (e: React.MouseEvent, type: 'note' | 'folder', id: string) => void
}

export const FolderTree = ({ onRightClick }: FolderTreeProps) => {
  const hydrated = useHydration()
  const { currentView } = useUIStore()
  const renameRequest = useUIStore(s => s.renameRequest)
  const clearRenameRequest = useUIStore(s => s.clearRenameRequest)
  const {
    notes,
    selectedNoteId,
    updateNote,
    moveNoteToFolder,
    getActiveNotes,
    getDeletedNotes,
    getRecentNotes,
    getNotesByTag,
    restoreNote,
    permanentlyDeleteNote,
    emptyTrash
  } = useNoteStore()
  const openNote = useWorkspaceStore(s => s.openNote)
  const {
    folders,
    activeFolderId,
    expandedFolders,
    setActiveFolder,
    toggleFolderExpanded,
    updateFolder,
    getRootFolders,
    getChildFolders
  } = useFolderStore()
  const { tags, getTagById } = useTagStore()

  // Use empty arrays during SSR to avoid hydration mismatch
  const rootFolders = useMemo(() => hydrated ? getRootFolders() : [], [folders, hydrated])
  const activeNotes = useMemo(() => hydrated ? getActiveNotes() : [], [notes, hydrated])
  const deletedNotes = useMemo(() => hydrated ? getDeletedNotes() : [], [notes, hydrated])
  const recentNotes = useMemo(() => hydrated ? getRecentNotes(10) : [], [notes, hydrated])

  // ── Drag & drop state ───────────────────────────────────────────────────
  // The id of the note currently being dragged (null when nothing is held);
  // kept in a ref so dragstart doesn't trigger a re-render.
  const draggedNoteIdRef = useRef<string | null>(null)
  // Visual highlight target: folder id, or '__root__' for the root drop zone.
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null)

  // ── Single vs double click on a note ────────────────────────────────────
  // Single click = open as preview (italic, replaceable). Double click =
  // open as pinned. We delay the single-click handler so a quick second
  // click cancels it (matches VS Code's explorer behaviour).
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleNoteClick = (id: string) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      openNote(id, { preview: true })
      clickTimerRef.current = null
    }, 200)
  }
  const handleNoteDoubleClick = (id: string) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    openNote(id, { preview: false })
  }

  const beginNoteDrag = (e: React.DragEvent, noteId: string) => {
    draggedNoteIdRef.current = noteId
    // Required for Firefox to register the drag; also exposes the id to drop.
    e.dataTransfer.setData('application/x-noteser-note', noteId)
    e.dataTransfer.effectAllowed = 'move'
  }
  const endNoteDrag = () => {
    draggedNoteIdRef.current = null
    setDragOverTarget(null)
  }
  const onFolderDragOver = (e: React.DragEvent, folderId: string) => {
    if (!draggedNoteIdRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverTarget !== folderId) setDragOverTarget(folderId)
  }
  const onFolderDrop = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    const id = draggedNoteIdRef.current
    if (id) moveNoteToFolder(id, folderId)
    endNoteDrag()
  }
  const onRootDragOver = (e: React.DragEvent) => {
    if (!draggedNoteIdRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverTarget !== '__root__') setDragOverTarget('__root__')
  }
  const onRootDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const id = draggedNoteIdRef.current
    if (id) moveNoteToFolder(id, null)
    endNoteDrag()
  }

  // Render note item
  const NoteItem = ({ note, className = '' }: { note: typeof notes[0]; className?: string }) => {
    const noteTags = note.tags.map(tagId => getTagById(tagId)).filter(Boolean)

    return (
      <div
        className={`obsidian-file-item ${
          selectedNoteId === note.id ? 'bg-obsidianHighlight' : ''
        } ${className}`}
        draggable={currentView !== 'trash'}
        onDragStart={e => beginNoteDrag(e, note.id)}
        onDragEnd={endNoteDrag}
        onClick={() => handleNoteClick(note.id)}
        onDoubleClick={() => handleNoteDoubleClick(note.id)}
        onContextMenu={e => onRightClick(e, 'note', note.id)}
      >
        <DocumentTextIcon className="w-4 h-4 mr-2 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {note.isPinned && (
              <StarIconSolid className="w-3 h-3 text-yellow-500 flex-shrink-0" />
            )}
            {currentView === 'trash' ? (
              <span className="truncate">{note.title}</span>
            ) : (
              <EditableText
                value={note.title}
                onSave={newTitle => updateNote(note.id, { title: newTitle })}
                isEditing={renameRequest?.type === 'note' && renameRequest.id === note.id}
                onEditingChange={(v) => { if (!v) clearRenameRequest() }}
              />
            )}
          </div>
          {noteTags.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {noteTags.slice(0, 2).map(tag => tag && (
                <Badge key={tag.id} color={tag.color} className="text-[10px] px-1 py-0">
                  {tag.name}
                </Badge>
              ))}
              {noteTags.length > 2 && (
                <span className="text-[10px] text-obsidianSecondaryText">
                  +{noteTags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Render folder with its child folders + its notes (recursive)
  const FolderItem = ({ folder, depth = 0 }: { folder: typeof folders[0]; depth?: number }) => {
    const isExpanded = expandedFolders[folder.id]
    const isActive = activeFolderId === folder.id
    const folderNotes = activeNotes.filter(n => n.folderId === folder.id)
    const childFolders = hydrated ? getChildFolders(folder.id) : []
    const childCount = folderNotes.length + childFolders.length

    const isDropTarget = dragOverTarget === folder.id
    return (
      <div className="mb-0.5">
        <div
          className={`obsidian-folder-item ${
            isActive ? 'bg-obsidianHighlight' : ''
          } ${isDropTarget ? 'outline outline-2 outline-obsidianAccentPurple bg-obsidianAccentPurple/10' : ''}`}
          style={{ paddingLeft: depth > 0 ? `${depth * 12 + 8}px` : undefined }}
          onClick={() => setActiveFolder(folder.id)}
          onContextMenu={e => onRightClick(e, 'folder', folder.id)}
          onDragOver={e => onFolderDragOver(e, folder.id)}
          onDragLeave={() => { if (dragOverTarget === folder.id) setDragOverTarget(null) }}
          onDrop={e => onFolderDrop(e, folder.id)}
        >
          <button
            className="mr-1 focus:outline-none"
            onClick={e => {
              e.stopPropagation()
              toggleFolderExpanded(folder.id)
            }}
          >
            {isExpanded ? (
              <ChevronDownIcon className="w-3.5 h-3.5" />
            ) : (
              <ChevronRightIcon className="w-3.5 h-3.5" />
            )}
          </button>
          <FolderIcon className="w-4 h-4 mr-1.5 text-obsidianSecondaryText" />
          <EditableText
            value={folder.name}
            onSave={newName => updateFolder(folder.id, { name: newName })}
            isEditing={renameRequest?.type === 'folder' && renameRequest.id === folder.id}
            onEditingChange={(v) => { if (!v) clearRenameRequest() }}
          />
          {childCount > 0 && (
            <span className="ml-auto text-xs text-obsidianSecondaryText">
              {childCount}
            </span>
          )}
        </div>
        {isExpanded && (
          <div>
            {/* Nested child folders first */}
            {childFolders.map(child => (
              <FolderItem key={child.id} folder={child} depth={depth + 1} />
            ))}
            {/* Then notes inside this folder */}
            <div style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
              {folderNotes.map(note => (
                <NoteItem key={note.id} note={note} />
              ))}
              {folderNotes.length === 0 && childFolders.length === 0 && (
                <div className="px-3 py-2 text-xs text-obsidianSecondaryText italic">
                  Empty folder
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render trash view
  if (currentView === 'trash') {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide">
            Trash ({deletedNotes.length})
          </h3>
          {deletedNotes.length > 0 && (
            <button
              onClick={emptyTrash}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Empty Trash
            </button>
          )}
        </div>
        {deletedNotes.length === 0 ? (
          <div className="text-center py-8 text-obsidianSecondaryText">
            <p className="text-sm">Trash is empty</p>
          </div>
        ) : (
          deletedNotes.map(note => (
            <div
              key={note.id}
              className={`obsidian-file-item ${
                selectedNoteId === note.id ? 'bg-obsidianHighlight' : ''
              }`}
              onClick={() => handleNoteClick(note.id)}
        onDoubleClick={() => handleNoteDoubleClick(note.id)}
            >
              <DocumentTextIcon className="w-4 h-4 mr-2 flex-shrink-0" />
              <span className="flex-1 truncate">{note.title}</span>
              <div className="flex gap-1">
                <button
                  onClick={e => {
                    e.stopPropagation()
                    restoreNote(note.id)
                  }}
                  className="text-xs text-obsidianAccentPurple hover:text-obsidianText transition-colors"
                >
                  Restore
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    permanentlyDeleteNote(note.id)
                  }}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    )
  }

  // Render recent view
  if (currentView === 'recent') {
    return (
      <div>
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
          Recently Modified
        </h3>
        {recentNotes.length === 0 ? (
          <div className="text-center py-8 text-obsidianSecondaryText">
            <p className="text-sm">No recent notes</p>
          </div>
        ) : (
          recentNotes.map(note => (
            <NoteItem key={note.id} note={note} />
          ))
        )}
      </div>
    )
  }

  // Render tags view
  if (currentView === 'tags') {
    return (
      <div>
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
          Tags
        </h3>
        {tags.length === 0 ? (
          <div className="text-center py-8 text-obsidianSecondaryText">
            <p className="text-sm">No tags yet</p>
            <p className="text-xs mt-1">Add tags to notes to organize them</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tags.map(tag => {
              const tagNotes = getNotesByTag(tag.id)
              return (
                <div key={tag.id}>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-obsidianDarkGray">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="text-sm text-obsidianText">{tag.name}</span>
                    <span className="ml-auto text-xs text-obsidianSecondaryText">
                      {tagNotes.length}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Render default notes view — Obsidian-style flat tree.
  // Sort: pinned notes first (still inline, no separate section), then
  // folders in their store order, then unpinned root notes.
  const rootNotes = activeNotes.filter(n => !n.folderId)
  const pinnedRootNotes = rootNotes.filter(n => n.isPinned)
  const unpinnedRootNotes = rootNotes.filter(n => !n.isPinned)

  if (rootFolders.length === 0 && rootNotes.length === 0) {
    return (
      <div
        className={`text-center py-8 text-obsidianSecondaryText min-h-full ${
          dragOverTarget === '__root__' ? 'outline outline-2 outline-obsidianAccentPurple' : ''
        }`}
        onDragOver={onRootDragOver}
        onDragLeave={() => { if (dragOverTarget === '__root__') setDragOverTarget(null) }}
        onDrop={onRootDrop}
      >
        <p className="text-sm">No notes yet</p>
        <p className="text-xs mt-1">Click + to create your first note</p>
      </div>
    )
  }

  const rootHighlighted = dragOverTarget === '__root__'
  return (
    <div
      className={`min-h-full ${rootHighlighted ? 'outline outline-2 outline-obsidianAccentPurple rounded' : ''}`}
      onDragOver={onRootDragOver}
      onDragLeave={(e) => {
        // Only clear when leaving the wrapper itself, not when crossing children.
        if (e.currentTarget === e.target && dragOverTarget === '__root__') setDragOverTarget(null)
      }}
      onDrop={onRootDrop}
    >
      {pinnedRootNotes.map(note => (
        <NoteItem key={note.id} note={note} />
      ))}
      {rootFolders.map(folder => (
        <FolderItem key={folder.id} folder={folder} />
      ))}
      {unpinnedRootNotes.map(note => (
        <NoteItem key={note.id} note={note} />
      ))}
    </div>
  )
}

export default FolderTree
