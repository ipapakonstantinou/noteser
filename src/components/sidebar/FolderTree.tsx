'use client'

import { useMemo } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  DocumentTextIcon,
  StarIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useNoteStore, useFolderStore, useUIStore, useTagStore } from '@/stores'
import { EditableText } from '../shared/EditableText'
import { Badge } from '../ui'

interface FolderTreeProps {
  onRightClick: (e: React.MouseEvent, type: 'note' | 'folder', id: string) => void
}

export const FolderTree = ({ onRightClick }: FolderTreeProps) => {
  const { currentView } = useUIStore()
  const {
    notes,
    selectedNoteId,
    selectNote,
    updateNote,
    getActiveNotes,
    getDeletedNotes,
    getRecentNotes,
    getNotesByTag,
    restoreNote,
    permanentlyDeleteNote,
    emptyTrash
  } = useNoteStore()
  const {
    folders,
    activeFolderId,
    expandedFolders,
    setActiveFolder,
    toggleFolderExpanded,
    updateFolder,
    getRootFolders
  } = useFolderStore()
  const { tags, getTagById } = useTagStore()

  const rootFolders = useMemo(() => getRootFolders(), [folders])
  const activeNotes = useMemo(() => getActiveNotes(), [notes])
  const deletedNotes = useMemo(() => getDeletedNotes(), [notes])
  const recentNotes = useMemo(() => getRecentNotes(10), [notes])

  // Render note item
  const NoteItem = ({ note, className = '' }: { note: typeof notes[0]; className?: string }) => {
    const noteTags = note.tags.map(tagId => getTagById(tagId)).filter(Boolean)

    return (
      <div
        className={`obsidian-file-item ${
          selectedNoteId === note.id ? 'bg-obsidianHighlight' : ''
        } ${className}`}
        onClick={() => selectNote(note.id)}
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

  // Render folder with its notes
  const FolderItem = ({ folder }: { folder: typeof folders[0] }) => {
    const isExpanded = expandedFolders[folder.id]
    const isActive = activeFolderId === folder.id
    const folderNotes = activeNotes.filter(n => n.folderId === folder.id)

    return (
      <div className="mb-1">
        <div
          className={`obsidian-folder-item ${
            isActive ? 'bg-obsidianHighlight' : ''
          }`}
          onClick={() => setActiveFolder(folder.id)}
          onContextMenu={e => onRightClick(e, 'folder', folder.id)}
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
          />
          {folderNotes.length > 0 && (
            <span className="ml-auto text-xs text-obsidianSecondaryText">
              {folderNotes.length}
            </span>
          )}
        </div>
        {isExpanded && (
          <div className="ml-5">
            {folderNotes.map(note => (
              <NoteItem key={note.id} note={note} />
            ))}
            {folderNotes.length === 0 && (
              <div className="px-3 py-2 text-xs text-obsidianSecondaryText italic">
                Empty folder
              </div>
            )}
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
              onClick={() => selectNote(note.id)}
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

  // Render default notes view
  const rootNotes = activeNotes.filter(n => !n.folderId)
  const pinnedNotes = activeNotes.filter(n => n.isPinned)

  return (
    <div>
      {/* Pinned notes */}
      {pinnedNotes.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2 flex items-center gap-1">
            <StarIcon className="w-3 h-3" />
            Pinned
          </h3>
          {pinnedNotes.map(note => (
            <NoteItem key={note.id} note={note} />
          ))}
        </div>
      )}

      {/* Folders */}
      {rootFolders.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
            Folders
          </h3>
          {rootFolders.map(folder => (
            <FolderItem key={folder.id} folder={folder} />
          ))}
        </div>
      )}

      {/* Root notes */}
      <div>
        <h3 className="text-xs font-medium text-obsidianSecondaryText uppercase tracking-wide mb-2">
          Notes
        </h3>
        {rootNotes.length === 0 && rootFolders.length === 0 ? (
          <div className="text-center py-8 text-obsidianSecondaryText">
            <p className="text-sm">No notes yet</p>
            <p className="text-xs mt-1">Click + to create your first note</p>
          </div>
        ) : (
          rootNotes.filter(n => !n.isPinned).map(note => (
            <NoteItem key={note.id} note={note} />
          ))
        )}
      </div>
    </div>
  )
}

export default FolderTree
