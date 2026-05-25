'use client'

import { useState, useEffect, useRef, useCallback, createElement } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import dynamic from 'next/dynamic'

// Lazy-loaded — react-syntax-highlighter + the oneDark theme ship ~300kB
// of Prism language grammars. Only mounts when the user actually renders
// a fenced code block in preview mode, keeping the main editor chunk
// lean. SSR off because the host page is client-only anyway.
const PrismHighlighter = dynamic(() => import('./PrismHighlighter'), {
  ssr: false,
  // Minimal placeholder while the chunk loads (typically <100ms on a warm cache).
  loading: () => null,
})
import type { EditorView } from '@codemirror/view'
import { useUIStore, useNoteStore, useWorkspaceStore } from '@/stores'
import { useEnsureNoteLoaded } from '@/hooks/useEnsureNoteLoaded'
import { renderWikilinks } from '@/utils/wikilinks'
import { decodeWikilinkHref, findFragmentLine } from '@/utils/wikilinkTarget'
import { expandEmbeds } from '@/utils/embeds'
import { resolveAttachmentPath } from '@/utils/attachments'
import { findNoteByTitleOrAlias } from '@/utils/aliases'
import { toggleTaskLineText, removeTaskPrefixFromLine } from '@/utils/tasks'
import { isTaskItemDone, type HastNode } from '@/utils/taskListItem'
import { SCROLL_TO_LINE_EVENT } from '@/utils/events'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { MobileFormattingToolbar } from './MobileFormattingToolbar'
import { FrontmatterPanel } from './FrontmatterPanel'
import { TaskQueryBlock } from './TaskQueryBlock'
import { BasesBlock } from './BasesBlock'
import { AttachmentImage } from './AttachmentImage'
import type { Note } from '@/types'

interface EditorContentProps {
  note: Note
  isPreviewMode: boolean
  onContentChange: (content: string) => void
}

export const EditorContent = ({ note, isPreviewMode, onContentChange }: EditorContentProps) => {
  const { setPreviewMode } = useUIStore()
  const { getActiveNotes } = useNoteStore()
  const openNote = useWorkspaceStore(s => s.openNote)

  // progressive-clone: if this note is still a SHELL (body not yet streamed in
  // by the first-clone background fill), fetch its body now and show a brief
  // "Loading note…" hint until it lands.
  const noteLoading = useEnsureNoteLoaded(note.id)

  // Local copy so the preview overlay reflects unsaved edits immediately.
  const [previewContent, setPreviewContent] = useState(note.content)
  useEffect(() => {
    setPreviewContent(note.content)
  }, [note.id, note.content])

  // Editor cursor state mirrored to drive the preview indicator. Captured on
  // entry to preview mode so the rendered preview can show a cursor marker.
  const [cursorLine, setCursorLine] = useState<number | null>(null)
  const [cursorOffset, setCursorOffset] = useState<number | null>(null)

  const activeNotes = getActiveNotes().filter(n => n.id !== note.id)

  const cmViewRef = useRef<EditorView | null>(null)
  const previewContainerRef = useRef<HTMLDivElement | null>(null)

  // Manual entry to preview (eye-icon button / shortcut). Captures cursor
  // position from the CodeMirror view so the preview can show a marker.
  useEffect(() => {
    if (!isPreviewMode) return
    const view = cmViewRef.current
    if (!view) return
    const pos = view.state.selection.main.head
    setPreviewContent(view.state.doc.toString())
    setCursorOffset(pos)
    setCursorLine(view.state.doc.lineAt(pos).number)
    view.contentDOM.blur()
  }, [isPreviewMode])

  // OutlineView dispatches `noteser:scroll-to-line` with { noteId, line }
  // when the user clicks a heading. If the event targets this note, jump
  // the CodeMirror view to that line. Listening on window keeps the two
  // components decoupled (same pattern as SYNC_REQUEST_EVENT).
  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<{ noteId?: string; line?: number }>).detail
      if (!detail) return
      if (detail.noteId !== note.id) return
      const targetLine = detail.line
      if (typeof targetLine !== 'number' || targetLine < 1) return
      const view = cmViewRef.current
      if (!view) return
      // Clamp to the doc — the source might have shrunk since the outline
      // was rendered (rapid edits + click race).
      const clamped = Math.min(targetLine, view.state.doc.lines)
      const line = view.state.doc.line(clamped)
      // Leaving preview mode is necessary for the editor to receive focus
      // and for the scroll to be visible.
      if (isPreviewMode) setPreviewMode(false)
      view.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true,
      })
      view.focus()
    }
    window.addEventListener(SCROLL_TO_LINE_EVENT, handler)
    return () => window.removeEventListener(SCROLL_TO_LINE_EVENT, handler)
  }, [note.id, isPreviewMode, setPreviewMode])

  const exitPreviewAndFocus = (insertText?: string) => {
    setCursorLine(null)
    setCursorOffset(null)
    setPreviewMode(false)
    requestAnimationFrame(() => {
      const view = cmViewRef.current
      if (!view) return
      view.focus()
      if (insertText) {
        const pos = view.state.selection.main.head
        view.dispatch({
          changes: { from: pos, insert: insertText },
          selection: { anchor: pos + insertText.length },
        })
      }
    })
  }

  // Toggle the task at a specific 1-indexed source line. Adds a ✅ date stamp
  // on check and strips it on uncheck (Obsidian Tasks-plugin behavior).
  const toggleTaskAt = useCallback((sourceLine: number) => {
    const view = cmViewRef.current
    if (!view) return
    if (sourceLine < 1 || sourceLine > view.state.doc.lines) return
    const line = view.state.doc.line(sourceLine)
    const newLine = toggleTaskLineText(line.text)
    if (newLine == null || newLine === line.text) return
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newLine },
    })
    setPreviewContent(view.state.doc.toString())
  }, [])

  // Strip the `- [ ]` prefix from a task line at the given 1-indexed source
  // line, leaving the body (including any ✅ date) as plain text. No-op when
  // the line isn't a task.
  const removeTaskPrefixAt = useCallback((sourceLine: number) => {
    const view = cmViewRef.current
    if (!view) return
    if (sourceLine < 1 || sourceLine > view.state.doc.lines) return
    const line = view.state.doc.line(sourceLine)
    const newLine = removeTaskPrefixFromLine(line.text)
    if (newLine == null || newLine === line.text) return
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newLine },
    })
    setPreviewContent(view.state.doc.toString())
  }, [])

  // Move the editor cursor without leaving preview.
  const moveCursorByKey = useCallback((key: string) => {
    const view = cmViewRef.current
    if (!view) return
    const head = view.state.selection.main.head
    const doc = view.state.doc
    let newPos = head
    if (key === 'ArrowLeft')  newPos = Math.max(0, head - 1)
    else if (key === 'ArrowRight') newPos = Math.min(doc.length, head + 1)
    else if (key === 'Home') newPos = doc.lineAt(head).from
    else if (key === 'End')  newPos = doc.lineAt(head).to
    else if (key === 'ArrowUp' || key === 'ArrowDown') {
      const line = doc.lineAt(head)
      const col = head - line.from
      const targetLineNum = key === 'ArrowUp' ? line.number - 1 : line.number + 1
      if (targetLineNum < 1 || targetLineNum > doc.lines) return
      const targetLine = doc.line(targetLineNum)
      newPos = Math.min(targetLine.from + col, targetLine.to)
    } else return
    view.dispatch({ selection: { anchor: newPos } })
    setCursorOffset(newPos)
    setCursorLine(doc.lineAt(newPos).number)
  }, [])

  // Preview-mode keyboard handler.
  useEffect(() => {
    if (!isPreviewMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      // Navigation: move CM cursor, stay in preview.
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        moveCursorByKey(e.key)
        return
      }

      // Alt+Shift+L: strip the `- [ ]` prefix at cursor line. Partner to the
      // editor's existing Alt+L behavior — kept consistent across modes so the
      // user can convert a task back to plain text from either view.
      if (e.altKey && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        if (cursorLine != null) {
          e.preventDefault()
          removeTaskPrefixAt(cursorLine)
        }
        return
      }

      // Alt+L: toggle task at cursor line.
      if (e.altKey && !e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        if (cursorLine != null) {
          e.preventDefault()
          toggleTaskAt(cursorLine)
        }
        return
      }

      // Skip shortcuts (so Ctrl/Cmd+key combos pass through).
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // Typing keys → exit preview and forward the character.
      let insert: string | undefined
      if (e.key.length === 1) insert = e.key
      else if (e.key === 'Enter') insert = '\n'
      else if (e.key === 'Backspace' || e.key === 'Delete') insert = undefined
      else return

      e.preventDefault()
      exitPreviewAndFocus(insert)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewMode, cursorLine, moveCursorByKey, toggleTaskAt, removeTaskPrefixAt])

  // Place a visual cursor marker inside the preview block after each render.
  useEffect(() => {
    if (!isPreviewMode || cursorOffset == null) return
    const container = previewContainerRef.current
    if (!container) return

    // Clear any previous marker.
    container.querySelectorAll('.preview-cursor-marker').forEach(el => el.remove())

    const block = container.querySelector('.preview-cursor-block') as HTMLElement | null
    if (!block) return

    const view = cmViewRef.current
    if (!view) return
    const line = view.state.doc.lineAt(cursorOffset)
    const col = cursorOffset - line.from

    // Walk text nodes inside the cursor block, counting characters,
    // approximating column-in-source ≈ offset-in-rendered-text.
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let remaining = col
    let targetNode: Text | null = null
    let targetOffset = 0
    let lastNode: Text | null = null
    let lastLen = 0
    while (true) {
      const n = walker.nextNode() as Text | null
      if (!n) break
      lastNode = n
      lastLen = n.nodeValue?.length ?? 0
      if (remaining <= lastLen) {
        targetNode = n
        targetOffset = remaining
        break
      }
      remaining -= lastLen
    }
    if (!targetNode && lastNode) {
      targetNode = lastNode
      targetOffset = lastLen
    }
    if (!targetNode) {
      // Empty block — place the marker as a child of the block itself.
      const span = document.createElement('span')
      span.className = 'preview-cursor-marker'
      span.setAttribute('aria-hidden', 'true')
      block.appendChild(span)
      return
    }
    const range = document.createRange()
    range.setStart(targetNode, targetOffset)
    range.setEnd(targetNode, targetOffset)
    const span = document.createElement('span')
    span.className = 'preview-cursor-marker'
    span.setAttribute('aria-hidden', 'true')
    range.insertNode(span)
  }, [isPreviewMode, cursorOffset, cursorLine, previewContent])

  // Wire up checkbox click handlers — remark-gfm renders inputs as `disabled`.
  // Match rendered checkboxes to source task lines in document order.
  useEffect(() => {
    if (!isPreviewMode) return
    const container = previewContainerRef.current
    if (!container) return
    const view = cmViewRef.current
    if (!view) return

    const source = view.state.doc.toString()
    const taskLines: number[] = []
    source.split('\n').forEach((text, idx) => {
      if (/^(\s*(?:[-*+]|\d+\.)\s+)\[[ xX]\]/.test(text)) taskLines.push(idx + 1)
    })

    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const handlers: Array<[HTMLInputElement, (e: Event) => void]> = []
    boxes.forEach((box, i) => {
      if (i >= taskLines.length) return
      const lineNum = taskLines[i]
      box.disabled = false
      box.style.cursor = 'pointer'
      const handler = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        toggleTaskAt(lineNum)
      }
      box.addEventListener('click', handler)
      handlers.push([box, handler])
    })
    return () => {
      handlers.forEach(([box, handler]) => box.removeEventListener('click', handler))
    }
  }, [isPreviewMode, previewContent, toggleTaskAt])

  // Style #tags in the rendered preview by walking text nodes and wrapping
  // matches in styled spans. Re-runs whenever the rendered content changes.
  useEffect(() => {
    if (!isPreviewMode) return
    const container = previewContainerRef.current
    if (!container) return

    const TAG_PATTERN = /(^|[^\w#/-])(#[A-Za-z0-9_/-]+)(?![\w/-])/g
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        // Skip text already inside <code>, <pre>, or our own .preview-tag spans.
        let p: Node | null = node.parentNode
        while (p && p !== container) {
          const el = p as HTMLElement
          if (el.tagName === 'CODE' || el.tagName === 'PRE') return NodeFilter.FILTER_REJECT
          if (el.classList?.contains('preview-tag')) return NodeFilter.FILTER_REJECT
          p = p.parentNode
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const targets: Text[] = []
    let n: Node | null
    while ((n = walker.nextNode())) targets.push(n as Text)

    for (const node of targets) {
      const text = node.nodeValue ?? ''
      TAG_PATTERN.lastIndex = 0
      if (!TAG_PATTERN.test(text)) continue
      TAG_PATTERN.lastIndex = 0
      const frag = document.createDocumentFragment()
      let lastIdx = 0
      let m: RegExpExecArray | null
      while ((m = TAG_PATTERN.exec(text)) !== null) {
        const before = text.slice(lastIdx, m.index + m[1].length)
        if (before) frag.appendChild(document.createTextNode(before))
        const span = document.createElement('span')
        span.className = 'preview-tag'
        span.textContent = m[2]
        frag.appendChild(span)
        lastIdx = m.index + m[1].length + m[2].length
      }
      const after = text.slice(lastIdx)
      if (after) frag.appendChild(document.createTextNode(after))
      node.parentNode?.replaceChild(frag, node)
    }
  }, [isPreviewMode, previewContent])

  const handleChange = (content: string) => {
    setPreviewContent(content)
    onContentChange(content)
  }

  // Helper: does this rendered block contain the editor's cursor line?
  const isCursorBlock = (node: { position?: { start?: { line?: number }; end?: { line?: number } } } | undefined): boolean => {
    if (cursorLine == null) return false
    const start = node?.position?.start?.line
    const end = node?.position?.end?.line
    return start != null && end != null && cursorLine >= start && cursorLine <= end
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
    if (!inline && language === 'tasks') {
      return <TaskQueryBlock source={String(children).replace(/\n$/, '')} />
    }
    if (!inline && language === 'bases') {
      return <BasesBlock source={String(children).replace(/\n$/, '')} />
    }
    if (!inline && language) {
      return (
        <PrismHighlighter
          language={language}
          className="rounded-lg !bg-obsidianDarkGray !mt-2 !mb-2"
        >
          {String(children).replace(/\n$/, '')}
        </PrismHighlighter>
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
      const decoded = decodeWikilinkHref(href)!
      const target = findNoteByTitleOrAlias(activeNotes, decoded.title)
      return (
        <span
          onClick={e => {
            e.stopPropagation()
            if (!target) return
            openNote(target.id)
            if (decoded.fragment && typeof window !== 'undefined') {
              // Defer so the editor for the target note has time to mount
              // before we dispatch the scroll-to-fragment event.
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('noteser:scroll-to-fragment', {
                  detail: { noteId: target.id, fragment: decoded.fragment },
                }))
              }, 0)
            }
          }}
          className={`cursor-pointer rounded px-0.5 transition-colors ${
            target ? 'text-obsidianAccentPurple hover:underline' : 'text-red-400 hover:underline'
          }`}
          title={target ? `Open: ${target.title}${decoded.fragment ? ` → ${decoded.fragment}` : ''}` : `Note not found: ${decoded.title}`}
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

  // ReactMarkdown passes a `node` (HAST element) plus standard intrinsic props.
  // We use ComponentType<any> on the receiving end so each Tag's specific props
  // signature is satisfied; the runtime shape is what matters here.
  interface MdProps {
    node?: { position?: { start?: { line?: number }; end?: { line?: number } }; children?: unknown[] }
    className?: string
    children?: React.ReactNode
    [key: string]: unknown
  }

  const wrapBlock = (Tag: keyof React.JSX.IntrinsicElements) => {
    const Block = ({ node, className, children, ...rest }: MdProps) => {
      const cls = [className, isCursorBlock(node) ? 'preview-cursor-block' : '']
        .filter(Boolean).join(' ')
      return createElement(Tag, { ...rest, className: cls || undefined }, children)
    }
    Block.displayName = `MdBlock(${Tag})`
    return Block as React.ComponentType<unknown>
  }

  const ListItem = ({ node, className, children, ...rest }: MdProps) => {
    // react-markdown v10 doesn't pass `checked` — derive it from the HAST node.
    // `isTaskItemDone` finds the checkbox belonging to THIS item (skipping
    // nested sub-lists and looking into a loose-list <p> wrapper), so nested
    // done tasks get struck and undone subtasks under a done parent do not.
    const isChecked = isTaskItemDone(node as HastNode | undefined)
    const cls = [
      className,
      isCursorBlock(node) ? 'preview-cursor-block' : '',
      isChecked ? 'preview-task-done' : '',
    ].filter(Boolean).join(' ')
    return <li className={cls || undefined} {...rest}>{children}</li>
  }
  ListItem.displayName = 'MdListItem'
  const TypedListItem = ListItem as unknown as React.ComponentType<unknown>

  const components = {
    code: CodeBlock as React.ComponentType<{ className?: string; children?: React.ReactNode }>,
    a: WikilinkAnchor as React.ComponentType<{ href?: string; children?: React.ReactNode }>,
    img: AttachmentImage as unknown as React.ComponentType<React.ImgHTMLAttributes<HTMLImageElement>>,
    p: wrapBlock('p'),
    h1: wrapBlock('h1'),
    h2: wrapBlock('h2'),
    h3: wrapBlock('h3'),
    h4: wrapBlock('h4'),
    h5: wrapBlock('h5'),
    h6: wrapBlock('h6'),
    blockquote: wrapBlock('blockquote'),
    pre: wrapBlock('pre'),
    li: TypedListItem,
  }

  return (
    <div className="relative flex-1 h-full overflow-hidden flex flex-col">
      {noteLoading && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-obsidianDarkGray/90 border border-obsidianBorder text-xs text-obsidianSecondaryText shadow"
          data-testid="note-loading-hint"
        >
          <span className="inline-block w-3 h-3 border-2 border-obsidianSecondaryText/40 border-t-obsidianAccentPurple rounded-full animate-spin" />
          Loading note…
        </div>
      )}
      <FrontmatterPanel
        content={note.content ?? ''}
        onChange={(next) => { setPreviewContent(next); onContentChange(next) }}
      />
      <CodeMirrorEditor
        noteId={note.id}
        initialContent={note.content}
        activeNotes={activeNotes}
        onSave={handleChange}
        onWikilinkNavigate={(n) => openNote(n.id)}
        viewRef={cmViewRef}
      />
      {!isPreviewMode && <MobileFormattingToolbar viewRef={cmViewRef} />}
      {isPreviewMode && (
        <div
          ref={previewContainerRef}
          className="absolute inset-0 overflow-auto p-4 bg-obsidianBlack z-10"
        >
          <div className="prose prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={components}
              // react-markdown v10's defaultUrlTransform strips
              // anything outside its (http|https|mailto|tel|#) allowlist
              // — that wiped our `wikilink://Title` hrefs and made the
              // WikilinkAnchor's click handler unreachable in preview
              // mode. Pass them through; sanitize everything else with
              // the default behaviour. (Caught by the qa-tester sweep.)
              urlTransform={(url) =>
                url.startsWith('wikilink://') ? url : defaultUrlTransform(url)
              }
            >
              {renderWikilinks(expandEmbeds(previewContent, getActiveNotes(), { resolveAttachment: resolveAttachmentPath })) || '*Start writing...*'}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}

export default EditorContent
