'use client'

import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { useUIStore, useNoteStore } from '@/stores'
import { renderWikilinks } from '@/utils/wikilinks'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import type { Note } from '@/types'

interface EditorContentProps {
  note: Note
  isPreviewMode: boolean
  onContentChange: (content: string) => void
}

export const EditorContent = ({ note, isPreviewMode, onContentChange }: EditorContentProps) => {
  const { togglePreview } = useUIStore()
  const { selectNote, getActiveNotes } = useNoteStore()

  // Keep a local copy for the preview renderer so it reflects unsaved edits immediately
  const [previewContent, setPreviewContent] = useState(note.content)

  useEffect(() => {
    setPreviewContent(note.content)
  }, [note.id, note.content])

  const activeNotes = getActiveNotes().filter(n => n.id !== note.id)

  const handleChange = (content: string) => {
    setPreviewContent(content)
    onContentChange(content)
  }

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

  // Link renderer that handles wikilink:// hrefs
  const WikilinkAnchor = ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href?.startsWith('wikilink://')) {
      const title = decodeURIComponent(href.slice('wikilink://'.length))
      const target = activeNotes.find(n => n.title.toLowerCase() === title.toLowerCase())
      return (
        <span
          onClick={e => { e.stopPropagation(); if (target) selectNote(target.id) }}
          className={`cursor-pointer rounded px-0.5 transition-colors ${
            target ? 'text-obsidianAccentPurple hover:underline' : 'text-red-400 hover:underline'
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

  // Reading mode — full rendered Markdown
  if (isPreviewMode) {
    return (
      <div className="flex-1 overflow-auto p-4 cursor-text" onClick={togglePreview}>
        <div className="prose prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: CodeBlock as React.ComponentType<{ className?: string; children?: React.ReactNode }>,
              a: WikilinkAnchor as React.ComponentType<{ href?: string; children?: React.ReactNode }>,
            }}
          >
            {renderWikilinks(previewContent) || '*Start writing...*'}
          </ReactMarkdown>
        </div>
      </div>
    )
  }

  // Live preview editing mode — CodeMirror
  return (
    <CodeMirrorEditor
      noteId={note.id}
      initialContent={note.content}
      activeNotes={activeNotes}
      onSave={handleChange}
      onWikilinkNavigate={(n) => selectNote(n.id)}
    />
  )
}

export default EditorContent
