'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { useDebouncedCallback } from '@/hooks/useDebounce'
import { useUIStore, useNoteStore } from '@/stores'
import { getActiveWikilinkQuery, renderWikilinks } from '@/utils/wikilinks'
import { getCaretCoordinates } from '@/utils/caretCoordinates'
import { WikilinkAutocomplete } from './WikilinkAutocomplete'
import type { Note } from '@/types'

interface EditorContentProps {
  note: Note
  isPreviewMode: boolean
  onContentChange: (content: string) => void
}

interface WikilinkState {
  query: string
  start: number
  position: { top: number; left: number }
}

export const EditorContent = ({
  note,
  isPreviewMode,
  onContentChange
}: EditorContentProps) => {
  const { togglePreview } = useUIStore()
  const { selectNote, getActiveNotes } = useNoteStore()
  const [localContent, setLocalContent] = useState(note.content)
  const [wikilinkState, setWikilinkState] = useState<WikilinkState | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeNotes = getActiveNotes().filter(n => n.id !== note.id)

  // Sync local content when switching notes
  useEffect(() => {
    setLocalContent(note.content)
    setWikilinkState(null)
  }, [note.id, note.content])

  const debouncedSave = useDebouncedCallback((content: string) => {
    onContentChange(content)
  }, 300)

  // Recalculate wikilink autocomplete state based on current cursor position
  const updateWikilinkState = useCallback((content: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const active = getActiveWikilinkQuery(content, cursorPos)

    if (!active) {
      setWikilinkState(null)
      return
    }

    const coords = getCaretCoordinates(textarea, cursorPos)
    const rect = textarea.getBoundingClientRect()
    const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 20

    setWikilinkState({
      query: active.query,
      start: active.start,
      position: {
        top: rect.top + coords.top - textarea.scrollTop + lineHeight,
        left: rect.left + coords.left,
      },
    })
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setLocalContent(newContent)
    debouncedSave(newContent)
    updateWikilinkState(newContent)
  }, [debouncedSave, updateWikilinkState])

  // Also recheck on cursor moves (click, arrow keys)
  const handleSelect = useCallback(() => {
    updateWikilinkState(localContent)
  }, [localContent, updateWikilinkState])

  const handleWikilinkSelect = useCallback((selectedNote: Note) => {
    if (!wikilinkState) return
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const insertion = `[[${selectedNote.title}]]`
    const newContent =
      localContent.slice(0, wikilinkState.start) +
      insertion +
      localContent.slice(cursorPos)
    const newCursor = wikilinkState.start + insertion.length

    setLocalContent(newContent)
    debouncedSave(newContent)
    setWikilinkState(null)

    requestAnimationFrame(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = newCursor
    })
  }, [wikilinkState, localContent, debouncedSave])

  const insertAtCursor = useCallback((text: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newContent = localContent.slice(0, start) + text + localContent.slice(end)

    setLocalContent(newContent)
    debouncedSave(newContent)

    const cursorPos = start + text.length
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = cursorPos
      textarea.focus()
    })
  }, [localContent, debouncedSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let autocomplete handle these keys when open
    if (wikilinkState && (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      return
    }

    const hasCtrl = e.ctrlKey || e.metaKey

    if (hasCtrl && e.shiftKey && e.key === '7') {
      e.preventDefault()
      insertAtCursor('1. ')
      return
    }
    if (hasCtrl && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault()
      insertAtCursor('- [ ] ')
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      insertAtCursor('  ')
      return
    }

    if (hasCtrl && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selected = localContent.slice(start, end)
      if (selected) {
        const newContent = localContent.slice(0, start) + `**${selected}**` + localContent.slice(end)
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

    if (hasCtrl && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selected = localContent.slice(start, end)
      if (selected) {
        const newContent = localContent.slice(0, start) + `*${selected}*` + localContent.slice(end)
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
  }, [wikilinkState, localContent, insertAtCursor, debouncedSave])

  // Custom code block renderer
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

  // Wikilink anchor renderer — handles wikilink:// hrefs
  const WikilinkAnchor = ({
    href,
    children,
  }: {
    href?: string
    children?: React.ReactNode
  }) => {
    if (href?.startsWith('wikilink://')) {
      const title = decodeURIComponent(href.slice('wikilink://'.length))
      const target = activeNotes.find(
        n => n.title.toLowerCase() === title.toLowerCase()
      )
      return (
        <span
          onClick={e => {
            e.stopPropagation()
            if (target) selectNote(target.id)
          }}
          className={`cursor-pointer rounded px-0.5 transition-colors ${
            target
              ? 'text-obsidianAccentPurple hover:underline'
              : 'text-red-400 hover:underline'
          }`}
          title={target ? `Open: ${target.title}` : `Note not found: ${title}`}
        >
          {children}
        </span>
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-obsidianAccentPurple hover:underline">
        {children}
      </a>
    )
  }

  if (isPreviewMode) {
    return (
      <div
        className="flex-1 overflow-auto p-4 cursor-text"
        onClick={togglePreview}
      >
        <div className="prose prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: CodeBlock as React.ComponentType<{ className?: string; children?: React.ReactNode }>,
              a: WikilinkAnchor as React.ComponentType<{ href?: string; children?: React.ReactNode }>,
            }}
          >
            {renderWikilinks(localContent) || '*Start writing...*'}
          </ReactMarkdown>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden relative">
      <textarea
        ref={textareaRef}
        value={localContent}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onClick={handleSelect}
        className="w-full h-full p-4 bg-obsidianBlack text-obsidianText resize-none focus:outline-none font-mono text-sm leading-relaxed"
        placeholder="Start writing... (Supports Markdown and [[wikilinks]])"
        spellCheck={false}
      />
      {wikilinkState && (
        <WikilinkAutocomplete
          query={wikilinkState.query}
          notes={activeNotes}
          position={wikilinkState.position}
          onSelect={handleWikilinkSelect}
          onClose={() => setWikilinkState(null)}
        />
      )}
    </div>
  )
}

export default EditorContent
