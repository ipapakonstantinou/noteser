// --- components/editor/EditorHeader.js ---
import { PencilIcon, EyeIcon } from '@heroicons/react/24/outline'

const EditorHeader = ({ title, isPreviewMode, onTogglePreview, onTitleChange }) => {
  return (
    <div className="flex justify-between items-center p-4 border-b border-obsidianBorder">
      <textarea
        value={title}
        onChange={e => onTitleChange(e.target.value)}
        className="w-full bg-obsidianBlack text-obsidianText text-xl font-medium resize-none focus:outline-none"
        placeholder="Enter note title..."
      />
      <button
        onClick={onTogglePreview}
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
