'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { useDebouncedCallback } from '@/hooks/useDebounce'
import { useUIStore } from '@/stores'
import { markdownLivePreview } from './markdownLivePreview'
import { tasksLivePreview } from './tasksLivePreview'
import { basesLivePreview } from './basesLivePreview'
import { imagesLivePreview } from './imagesLivePreview'
import { getActiveWikilinkQuery } from '@/utils/wikilinks'
import { findNoteByTitleOrAlias } from '@/utils/aliases'
import { toggleTaskLineText, UI_TASK_LINE_REGEX } from '@/utils/tasks'
import { saveAttachment } from '@/utils/attachments'
import { WikilinkAutocomplete } from './WikilinkAutocomplete'
import type { Note } from '@/types'

interface WikilinkState {
  query: string
  start: number
  position: { top: number; left: number }
}

interface CodeMirrorEditorProps {
  noteId: string
  initialContent: string
  activeNotes: Note[]
  onSave: (content: string) => void
  onWikilinkNavigate: (note: Note) => void
  viewRef?: React.MutableRefObject<EditorView | null>
}

// Save dropped/pasted images to IndexedDB and splice markdown image
// references into the document at `pos`. Async on purpose — the drop/paste
// event handler kicks this off and returns immediately so CodeMirror doesn't
// block on the IDB write.
async function insertImagesAt(view: EditorView, files: File[], pos: number): Promise<void> {
  const refs: string[] = []
  for (const file of files) {
    try {
      const path = await saveAttachment(file, file.name || 'image.png')
      const alt = (file.name || 'image').replace(/\.[^.]+$/, '')
      refs.push(`![${alt}](${path})`)
    } catch (err) {
      console.error('Failed to save dropped attachment', err)
    }
  }
  if (refs.length === 0) return
  // Join with blank lines so each image renders as its own block. Anchor the
  // caret immediately after the last reference.
  const insert = refs.join('\n\n')
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length },
  })
}

const obsidianTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#dadada', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', height: '100%' },
  '.cm-content': {
    fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace',
    lineHeight: '1.7',
    padding: '16px',
    caretColor: '#dadada',
    minHeight: '100%',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#dadada' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#4d4d4d' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: '#6b7280' },
})

export function CodeMirrorEditor({
  noteId,
  initialContent,
  activeNotes,
  onSave,
  onWikilinkNavigate,
  viewRef,
}: CodeMirrorEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const [wikilinkState, setWikilinkState] = useState<WikilinkState | null>(null)

  // Stable refs so extension callbacks always see the latest values
  const activeNotesRef = useRef(activeNotes)
  const navigateRef = useRef(onWikilinkNavigate)
  const noteIdRef = useRef(noteId)
  useEffect(() => { activeNotesRef.current = activeNotes }, [activeNotes])
  useEffect(() => { navigateRef.current = onWikilinkNavigate }, [onWikilinkNavigate])
  useEffect(() => { noteIdRef.current = noteId }, [noteId])

  const debouncedSave = useDebouncedCallback(onSave, 300)

  // Extensions are stable (created once) — callbacks reach out to refs for fresh values
  const extensions = useMemo(() => [
    markdown({ base: markdownLanguage }),
    markdownLivePreview,
    tasksLivePreview,
    basesLivePreview,
    imagesLivePreview,
    obsidianTheme,
    EditorView.lineWrapping,
    // Prec.highest ensures our bindings win over any conflicting default keymap.
    Prec.highest(keymap.of([
    {
      key: 'Ctrl-e',
      preventDefault: true,
      run() {
        useUIStore.getState().togglePreview()
        return true
      },
    },
    {
      key: 'Alt-l',
      preventDefault: true,
      run(view) {
        const { state } = view
        const { head } = state.selection.main
        const line = state.doc.lineAt(head)
        const taskMatch = line.text.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+)/)
        if (taskMatch) {
          // Toggle off: remove the task marker
          const indent = taskMatch[1].length
          const markerLen = taskMatch[2].length
          view.dispatch({
            changes: { from: line.from + indent, to: line.from + indent + markerLen, insert: '' },
            selection: { anchor: Math.max(line.from, head - markerLen) },
          })
        } else {
          // Toggle on: prepend "- [ ] " (preserving any indentation)
          const indent = line.text.match(/^(\s*)/)![1].length
          const insertAt = line.from + indent
          view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: '- [ ] ' },
            selection: { anchor: head + 6 },
          })
        }
        return true
      },
    },
    {
      // Partner to Alt+L. Check/uncheck the task on the current line, with
      // Obsidian-style ✅ date stamp on check / strip on uncheck. No-op on
      // non-task lines (falls through to default key handling).
      key: 'Alt-Shift-l',
      preventDefault: true,
      run(view) {
        const { head } = view.state.selection.main
        const line = view.state.doc.lineAt(head)
        const newLine = toggleTaskLineText(line.text)
        if (newLine == null || newLine === line.text) return false
        view.dispatch({ changes: { from: line.from, to: line.to, insert: newLine } })
        return true
      },
    },
    {
      // Open the "Create or edit Task" modal for the task line under the
      // cursor. Mirrors Obsidian Tasks' Mod+Shift+T binding. No-op for lines
      // that aren't task lines — falls through so the chord still works in
      // future for non-task contexts (e.g. turn-into-task) without us having
      // to claim the key globally.
      key: 'Mod-Shift-t',
      preventDefault: true,
      run(view) {
        const { head } = view.state.selection.main
        const line = view.state.doc.lineAt(head)
        if (!UI_TASK_LINE_REGEX.test(line.text)) return false
        useUIStore.getState().openModal({
          type: 'task-edit',
          data: { noteId: noteIdRef.current, line: line.number - 1 },
        })
        return true
      },
    },
    ])),
    EditorView.domEventHandlers({
      dragover(event) {
        // Allow drop only when files are being dragged. Without preventDefault
        // on dragover, the browser refuses the subsequent drop event.
        if (event.dataTransfer?.types?.includes('Files')) {
          event.preventDefault()
        }
        return false
      },
      drop(event, view) {
        const files = Array.from(event.dataTransfer?.files ?? [])
        const images = files.filter(f => f.type.startsWith('image/'))
        if (images.length === 0) return false
        event.preventDefault()
        const dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          ?? view.state.selection.main.head
        insertImagesAt(view, images, dropPos)
        return true
      },
      paste(event, view) {
        const files = Array.from(event.clipboardData?.files ?? [])
        const images = files.filter(f => f.type.startsWith('image/'))
        // Skip if no images, or if there's text alongside (rich paste — let
        // CodeMirror handle that path so user keeps the text).
        if (images.length === 0) return false
        const hasText = (event.clipboardData?.getData('text/plain') ?? '') !== ''
        if (hasText) return false
        event.preventDefault()
        const head = view.state.selection.main.head
        insertImagesAt(view, images, head)
        return true
      },
      mousedown(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return false

        // ── Checkbox toggle ──────────────────────────────────────────────────
        const line = view.state.doc.lineAt(pos)
        const cbMatch = line.text.match(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/)
        if (cbMatch) {
          const cbStart = line.from + cbMatch[1].length // index of '['
          const cbEnd   = cbStart + 3                   // index after ']'
          // Only toggle if the click landed on or near the [ ] glyph. We
          // route through toggleTaskLineText (rather than a single-char
          // swap) so recurring tasks get the ✅-stamp + new-instance
          // behavior on click.
          if (pos >= cbStart && pos <= cbEnd) {
            const newLine = toggleTaskLineText(line.text)
            if (newLine != null && newLine !== line.text) {
              view.dispatch({
                changes: { from: line.from, to: line.to, insert: newLine },
              })
              event.preventDefault()
              return true
            }
          }
        }

        // ── Ctrl/Cmd+Click wikilink navigation ───────────────────────────────
        if (event.ctrlKey || event.metaKey) {
          const content = view.state.doc.toString()
          const before = content.slice(0, pos)
          const after  = content.slice(pos)
          const openIdx  = before.lastIndexOf('[[')
          const closeIdx = after.indexOf(']]')
          if (openIdx !== -1 && closeIdx !== -1) {
            const rawTitle = content.slice(openIdx + 2, pos + closeIdx)
            if (!rawTitle.includes('\n') && !rawTitle.includes('[[')) {
              const title = rawTitle.split('|')[0].trim()
              const note = findNoteByTitleOrAlias(activeNotesRef.current, title)
              if (note) {
                event.preventDefault()
                navigateRef.current(note)
                return true
              }
            }
          }
        }

        return false
      },
    }),
  ], [])

  const updateWikilinkState = useCallback((content: string) => {
    const view = cmRef.current?.view
    if (!view) return
    const cursorPos = view.state.selection.main.head
    const active = getActiveWikilinkQuery(content, cursorPos)
    if (!active) { setWikilinkState(null); return }
    const coords = view.coordsAtPos(cursorPos)
    if (!coords) return
    setWikilinkState({
      query: active.query,
      start: active.start,
      position: { top: coords.bottom + 4, left: coords.left },
    })
  }, [])

  const handleChange = useCallback((value: string) => {
    debouncedSave(value)
    updateWikilinkState(value)
  }, [debouncedSave, updateWikilinkState])

  const handleWikilinkSelect = useCallback((note: Note) => {
    if (!wikilinkState) return
    const view = cmRef.current?.view
    if (!view) return
    const cursorPos = view.state.selection.main.head
    const insertion = `[[${note.title}]]`
    view.dispatch({
      changes: { from: wikilinkState.start, to: cursorPos, insert: insertion },
      selection: { anchor: wikilinkState.start + insertion.length },
    })
    setWikilinkState(null)
    view.focus()
    navigateRef.current(note)
  }, [wikilinkState])

  return (
    <div className="flex-1 overflow-hidden h-full relative bg-obsidianBlack">
      <CodeMirror
        key={noteId}
        ref={cmRef}
        value={initialContent}
        extensions={extensions}
        onChange={handleChange}
        onCreateEditor={(view) => {
          if (viewRef) viewRef.current = view
        }}
        placeholder="Start writing…  Markdown and [[wikilinks]] supported"
        height="100%"
        className="h-full"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: false,
          // CodeMirror's defaultHighlightStyle underlines headings — our
          // markdownLivePreview already provides bold + larger font for
          // headings, italics for emphasis, etc. Disable the default so the
          // heading underline (and other duplicate styling) doesn't fight us.
          syntaxHighlighting: false,
          closeBracketsKeymap: false,
          defaultKeymap: true,
          searchKeymap: false,
          historyKeymap: true,
          foldKeymap: false,
          completionKeymap: false,
          lintKeymap: false,
        }}
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
