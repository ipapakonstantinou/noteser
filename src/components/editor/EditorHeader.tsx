'use client'

import { useState, useRef, useEffect } from 'react'
import {
  EyeIcon,
  PencilIcon,
  TagIcon,
  StarIcon,
  UsersIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid'
import { useUIStore, useNoteStore, useTagStore, useCollaborationStore } from '@/stores'
import { Badge, Input } from '@/components/ui'
import { CollaboratorAvatars } from './CollaboratorAvatars'
import type { Note } from '@/types'

interface EditorHeaderProps {
  note: Note
  onTitleChange: (title: string) => void
}

export const EditorHeader = ({ note, onTitleChange }: EditorHeaderProps) => {
  const { isPreviewMode, togglePreview, showCollaborators, toggleCollaborators } = useUIStore()
  const { togglePinNote, updateNote } = useNoteStore()
  const { tags, addTag, getTagById } = useTagStore()
  const { getRoomUsers } = useCollaborationStore()

  const [isAddingTag, setIsAddingTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)

  const noteTags = note.tags.map(tagId => getTagById(tagId)).filter(Boolean)
  const roomUsers = getRoomUsers(note.id)

  useEffect(() => {
    if (isAddingTag && tagInputRef.current) {
      tagInputRef.current.focus()
    }
  }, [isAddingTag])

  const handleAddTag = () => {
    if (!newTagName.trim()) {
      setIsAddingTag(false)
      return
    }

    const tag = addTag(newTagName.trim())
    if (!note.tags.includes(tag.id)) {
      updateNote(note.id, { tags: [...note.tags, tag.id] })
    }
    setNewTagName('')
    setIsAddingTag(false)
  }

  const handleRemoveTag = (tagId: string) => {
    updateNote(note.id, { tags: note.tags.filter(id => id !== tagId) })
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const wordCount = note.content.trim().split(/\s+/).filter(Boolean).length

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

        {/* Collaborators */}
        {roomUsers.length > 0 && (
          <CollaboratorAvatars users={roomUsers} />
        )}

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

      {/* Tags and metadata row */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-obsidianSecondaryText border-t border-obsidianBorder/50">
        {/* Tags */}
        <div className="flex items-center gap-2 flex-wrap">
          <TagIcon className="w-4 h-4" />
          {noteTags.map(tag => tag && (
            <Badge
              key={tag.id}
              color={tag.color}
              onRemove={() => handleRemoveTag(tag.id)}
            >
              {tag.name}
            </Badge>
          ))}
          {isAddingTag ? (
            <div className="flex items-center gap-1">
              <input
                ref={tagInputRef}
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddTag()
                  if (e.key === 'Escape') setIsAddingTag(false)
                }}
                placeholder="Tag name..."
                className="w-20 px-1 py-0.5 bg-obsidianDarkGray border border-obsidianBorder rounded text-xs text-obsidianText focus:outline-none focus:ring-1 focus:ring-obsidianAccentPurple"
              />
              <button
                onClick={handleAddTag}
                className="p-0.5 text-green-500 hover:bg-green-500/10 rounded"
              >
                <CheckIcon className="w-3 h-3" />
              </button>
              <button
                onClick={() => setIsAddingTag(false)}
                className="p-0.5 text-red-500 hover:bg-red-500/10 rounded"
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingTag(true)}
              className="px-1.5 py-0.5 text-obsidianSecondaryText hover:text-obsidianText hover:bg-obsidianHighlight rounded transition-colors"
            >
              + Add tag
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Metadata */}
        <span>{wordCount} words</span>
        <span>Modified {formatDate(note.updatedAt)}</span>
      </div>
    </div>
  )
}

export default EditorHeader
