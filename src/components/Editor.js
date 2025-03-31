import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PencilIcon, EyeIcon } from '@heroicons/react/24/outline'

const Editor = ({ note, onEditNote }) => {
  const [isPreviewMode, setIsPreviewMode] = useState(false)

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center text-obsidianSecondaryText h-full">
        Select a note to start editing
      </div>
    )
  }

  const handleContentChange = e => {
    onEditNote({ ...note, content: e.target.value })
  }

  const handleTitleChange = e => {
    onEditNote({ ...note, title: e.target.value })
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Note Header with Always Editable Title */}
      <div className="flex justify-between items-center p-4 border-b border-obsidianBorder">
        <textarea
          value={note.title}
          onChange={handleTitleChange}
          className="w-full bg-obsidianBlack text-obsidianText text-xl font-medium resize-none focus:outline-none"
          placeholder="Enter note title..."
        />
        <button
          onClick={() => setIsPreviewMode(!isPreviewMode)}
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

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        {isPreviewMode ? (
          <div className="prose prose-invert max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {note.content}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={note.content}
            onChange={handleContentChange}
            className="w-full h-full p-4 bg-obsidianBlack resize-none focus:outline-none"
            placeholder="Start writing..."
          />
        )}
      </div>
    </div>
  )
}

export default Editor
