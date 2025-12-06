'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { useDebouncedCallback } from '@/hooks/useDebounce'
import type { Note } from '@/types'

interface EditorContentProps {
  note: Note
  isPreviewMode: boolean
  onContentChange: (content: string) => void
}

export const EditorContent = ({
  note,
  isPreviewMode,
  onContentChange
}: EditorContentProps) => {
  const [localContent, setLocalContent] = useState(note.content)
  const [showPreview, setShowPreview] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Sync local content with note
  useEffect(() => {
    setLocalContent(note.content)
    setShowPreview(false)
  }, [note.id, note.content])

  // Debounced save
  const debouncedSave = useDebouncedCallback(
    (content: string) => {
      onContentChange(content)
    },
    300
  )

  // Show preview after typing stops
  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current)
      }
    }
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setLocalContent(newContent)
    setShowPreview(false)
    debouncedSave(newContent)

    // Show preview after 800ms of no typing
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }
    previewTimeoutRef.current = setTimeout(() => {
      setShowPreview(true)
    }, 800)
  }, [debouncedSave])

  const insertAtCursor = useCallback((text: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newContent = localContent.slice(0, start) + text + localContent.slice(end)

    setLocalContent(newContent)
    setShowPreview(false)
    debouncedSave(newContent)

    // Restore cursor position
    const cursorPos = start + text.length
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = cursorPos
      textarea.focus()
    })
  }, [localContent, debouncedSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const hasCtrl = e.ctrlKey || e.metaKey

    // Ctrl+Shift+7 - Insert numbered list
    if (hasCtrl && e.shiftKey && e.key === '7') {
      e.preventDefault()
      insertAtCursor('1. ')
      return
    }

    // Ctrl+Shift+T - Insert todo
    if (hasCtrl && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault()
      insertAtCursor('- [ ] ')
      return
    }

    // Tab - Insert 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      insertAtCursor('  ')
      return
    }

    // Ctrl+B - Bold
    if (hasCtrl && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selectedText = localContent.slice(start, end)

      if (selectedText) {
        const newContent = localContent.slice(0, start) + `**${selectedText}**` + localContent.slice(end)
        setLocalContent(newContent)
        debouncedSave(newContent)
      } else {
        insertAtCursor('****')
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2
        })
      }
      return
    }

    // Ctrl+I - Italic
    if (hasCtrl && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selectedText = localContent.slice(start, end)

      if (selectedText) {
        const newContent = localContent.slice(0, start) + `*${selectedText}*` + localContent.slice(end)
        setLocalContent(newContent)
        debouncedSave(newContent)
      } else {
        insertAtCursor('**')
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1
        })
      }
      return
    }
  }, [localContent, insertAtCursor, debouncedSave])

  // Custom code block renderer with syntax highlighting
  const CodeBlock = ({
    inline,
    className,
    children,
    ...props
  }: {
    inline?: boolean
    className?: string
    children?: React.ReactNode
  }) => {
    const match = /language-(\w+)/.exec(className || '')
    const language = match ? match[1] : ''

    if (!inline && language) {
      return (
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          className="rounded-lg !bg-obsidianDarkGray !mt-2 !mb-2"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      )
    }

    return (
      <code className={`${className} px-1 py-0.5 bg-obsidianDarkGray rounded text-sm`} {...props}>
        {children}
      </code>
    )
  }

  // Preview mode
  if (isPreviewMode && showPreview) {
    return (
      <div
        className="flex-1 overflow-auto p-4 cursor-text"
        onClick={() => setShowPreview(false)}
      >
        <div className="prose prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: CodeBlock as React.ComponentType<{className?: string; children?: React.ReactNode}>
            }}
          >
            {localContent || '*Start writing...*'}
          </ReactMarkdown>
        </div>
      </div>
    )
  }

  // Edit mode
  return (
    <div className="flex-1 overflow-hidden">
      <textarea
        ref={textareaRef}
        value={localContent}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="w-full h-full p-4 bg-obsidianBlack text-obsidianText resize-none focus:outline-none font-mono text-sm leading-relaxed"
        placeholder="Start writing... (Supports Markdown)"
        spellCheck={false}
      />
    </div>
  )
}

export default EditorContent
