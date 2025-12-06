'use client'

import { useMemo } from 'react'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import { useNoteStore, useUIStore } from '@/stores'
import { EditorHeader } from './EditorHeader'
import { EditorContent } from './EditorContent'
import { CollaboratorAvatars } from './CollaboratorAvatars'
import { EmptyState } from '@/components/ui'

export const Editor = () => {
  const { selectedNoteId, getNoteById, updateNote } = useNoteStore()
  const { isPreviewMode } = useUIStore()

  const note = useMemo(() => {
    return selectedNoteId ? getNoteById(selectedNoteId) : null
  }, [selectedNoteId, getNoteById])

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-obsidianBlack">
        <EmptyState
          icon={<DocumentTextIcon className="w-16 h-16" />}
          title="No note selected"
          description="Select a note from the sidebar or create a new one to get started"
        />
      </div>
    )
  }

  const handleTitleChange = (title: string) => {
    updateNote(note.id, { title })
  }

  const handleContentChange = (content: string) => {
    updateNote(note.id, { content })
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-obsidianBlack">
      <EditorHeader
        note={note}
        onTitleChange={handleTitleChange}
      />
      <EditorContent
        note={note}
        isPreviewMode={isPreviewMode}
        onContentChange={handleContentChange}
      />
    </div>
  )
}

export default Editor
