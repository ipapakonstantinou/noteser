// --- components/editor/EditorContent.js ---
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const EditorContent = ({ content, isPreviewMode, onContentChange }) => {
  return (
    <div className="flex-1 overflow-auto">
      {isPreviewMode ? (
        <div className="prose prose-invert max-w-none p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={content}
          onChange={e => onContentChange(e.target.value)}
          className="w-full h-full p-4 bg-obsidianBlack resize-none focus:outline-none"
          placeholder="Start writing..."
        />
      )}
    </div>
  )
}

export default EditorContent
