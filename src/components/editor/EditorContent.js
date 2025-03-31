// --- components/editor/EditorContent.js ---
import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const EditorContent = ({ content, isPreviewMode, onContentChange }) => {
  const [value, setValue] = useState(content)
  const [showingPreview, setShowingPreview] = useState(false)
  const timeout = useRef(null)

  useEffect(() => {
    setValue(content)
  }, [content])

  const handleChange = (e) => {
    const newValue = e.target.value
    setValue(newValue)
    setShowingPreview(false)
    onContentChange(newValue)

    clearTimeout(timeout.current)
    timeout.current = setTimeout(() => {
      setShowingPreview(true)
    }, 800)
  }

  return (
    <div className="flex-1 overflow-auto">
      {isPreviewMode && showingPreview ? (
        <div
          className="prose prose-invert max-w-none p-4"
          onClick={() => setShowingPreview(false)}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {value}
          </ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={value}
          onChange={handleChange}
          autoFocus
          className="w-full h-full p-4 bg-obsidianBlack resize-none focus:outline-none"
          placeholder="Start writing..."
        />
      )}
    </div>
  )
}

export default EditorContent