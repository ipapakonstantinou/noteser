// --- components/editor/EditorContent.js ---
import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const EditorContent = ({ content, isPreviewMode, onContentChange }) => {
  const [value, setValue] = useState(content)
  const [showingPreview, setShowingPreview] = useState(false)
  const timeout = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    setValue(content)
    setShowingPreview(false)
  }, [content])

  useEffect(() => {
    return () => clearTimeout(timeout.current)
  }, [isPreviewMode])

  const insertAtCursor = insertText => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newValue = value.slice(0, start) + insertText + value.slice(end)
    setValue(newValue)
    setShowingPreview(false)
    onContentChange(newValue)

    const cursorPos = start + insertText.length
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = cursorPos
    })
  }

  const handleChange = e => {
    const newValue = e.target.value
    setValue(newValue)
    setShowingPreview(false)
    onContentChange(newValue)

    clearTimeout(timeout.current)
    timeout.current = setTimeout(() => {
      setShowingPreview(true)
    }, 800)
  }

  const handleKeyDown = e => {
    if (e.ctrlKey && e.shiftKey && e.key === '7') {
      e.preventDefault()
      insertAtCursor('1. ')
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault()
      insertAtCursor('- [ ] ')
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      {isPreviewMode && showingPreview ? (
        <div
          className="prose prose-invert max-w-none p-4"
          onClick={() => setShowingPreview(false)}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoFocus
          className="w-full h-full p-4 bg-obsidianBlack resize-none focus:outline-none"
          placeholder="Start writing..."
        />
      )}
    </div>
  )
}

export default EditorContent
