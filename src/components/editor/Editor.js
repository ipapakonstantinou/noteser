// --- components/editor/Editor.js ---
import { useState } from 'react'
import EditorHeader from './EditorHeader'
import EditorContent from './EditorContent'

const Editor = ({ note, onEditNote }) => {
  const [isPreviewMode, setIsPreviewMode] = useState(false)

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center text-obsidianSecondaryText h-full">
        Select a note to start editing
      </div>
    )
  }

  const updateNote = changes => onEditNote({ ...note, ...changes })

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <EditorHeader
        title={note.title}
        isPreviewMode={isPreviewMode}
        onTogglePreview={() => setIsPreviewMode(!isPreviewMode)}
        onTitleChange={title => updateNote({ title })}
      />
      <EditorContent
        content={note.content}
        isPreviewMode={isPreviewMode}
        onContentChange={content => updateNote({ content })}
      />
    </div>
  )
}

export default Editor