'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { diffGutterExtension, setDiffBaseline } from './diffGutter'
import { getLastPushedContent } from '@/utils/lastPushedContent'
import { useDebouncedCallback } from '@/hooks/useDebounce'
import { useUIStore, useGitHubStore } from '@/stores'
import { markdownLivePreview } from './markdownLivePreview'
import { tasksLivePreview } from './tasksLivePreview'
import { basesLivePreview } from './basesLivePreview'
import { imagesLivePreview } from './imagesLivePreview'
import { getActiveWikilinkQuery } from '@/utils/wikilinks'
import { getActiveTagQuery } from '@/utils/tagAutocomplete'
import { collectAllTags } from '@/utils/tags'
import { findNoteByTitleOrAlias } from '@/utils/aliases'
import { toggleTaskLineText, UI_TASK_LINE_REGEX } from '@/utils/tasks'
import {
  buildEmptyRow,
  buildTable,
  findCellIndexAtPos,
  findCellRanges,
  findTableBounds,
  nextCellTarget,
  prevCellTarget,
} from '@/utils/markdownTable'
import { findFragmentLine } from '@/utils/wikilinkTarget'
import {
  appendBlockId,
  buildBlockRefLink,
  extractTrailingBlockId,
  generateBlockId,
} from '@/utils/blockRef'
import { useNoteStore } from '@/stores/noteStore'
import { saveAttachment } from '@/utils/attachments'
import { WikilinkAutocomplete } from './WikilinkAutocomplete'
import { TagAutocomplete } from './TagAutocomplete'
import type { Note } from '@/types'

interface WikilinkState {
  query: string
  start: number
  position: { top: number; left: number }
}

interface TagState {
  query: string
  start: number // position of `#`
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
  // No display:none on .cm-gutters — basicSetup disables line-numbers
  // and fold-gutter (see <CodeMirror basicSetup={...} />), so the only
  // gutter mounted is our diff gutter, which needs to render.
  '.cm-placeholder': { color: '#6b7280' },
  // Search / replace panel — repaint it in the Obsidian palette so it
  // doesn't look like a stray native form on top of the editor.
  '.cm-panels': { backgroundColor: '#1e1e1e', color: '#dadada', borderColor: '#3a3a3a' },
  '.cm-panel.cm-search': {
    backgroundColor: '#1e1e1e',
    padding: '6px 8px',
    borderBottom: '1px solid #3a3a3a',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    fontSize: '12px',
  },
  '.cm-panel.cm-search input[type=text]': {
    backgroundColor: '#2a2a2a',
    color: '#dadada',
    border: '1px solid #3a3a3a',
    borderRadius: '3px',
    padding: '2px 6px',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: '#2a2a2a',
    color: '#dadada',
    border: '1px solid #3a3a3a',
    borderRadius: '3px',
    padding: '2px 8px',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search button:hover': { backgroundColor: '#3a3a3a' },
  '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.25)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(250, 204, 21, 0.55)' },
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
  const [tagState, setTagState] = useState<TagState | null>(null)

  // Stable refs so extension callbacks always see the latest values
  const activeNotesRef = useRef(activeNotes)
  const navigateRef = useRef(onWikilinkNavigate)
  const noteIdRef = useRef(noteId)
  useEffect(() => { activeNotesRef.current = activeNotes }, [activeNotes])
  useEffect(() => { navigateRef.current = onWikilinkNavigate }, [onWikilinkNavigate])
  useEffect(() => { noteIdRef.current = noteId }, [noteId])

  // Diff-gutter baseline (109): when the note changes — or after a
  // successful sync writes a fresh snapshot — fetch the last-pushed
  // content from IDB and dispatch it into the editor so the gutter
  // knows what to diff against. No snapshot yet (note never pushed)
  // → empty string, which computeDiffMarkers treats as "clean".
  const lastSyncedAt = useGitHubStore(s => s.lastSyncedAt)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const baseline = (await getLastPushedContent(noteId)) ?? ''
      if (cancelled) return
      const view = cmRef.current?.view
      if (!view) return
      view.dispatch({ effects: setDiffBaseline.of(baseline) })
    })()
    return () => { cancelled = true }
  }, [noteId, lastSyncedAt])

  // Listen for "scroll to fragment" requests fired by the wikilink click
  // handler. The fragment is either a heading text or a `^block-id`; we
  // resolve to a line number via findFragmentLine and dispatch a CodeMirror
  // selection change so the editor scrolls + highlights the row.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ noteId: string; fragment: string }>).detail
      if (!detail || detail.noteId !== noteIdRef.current) return
      const view = cmRef.current?.view
      if (!view) return
      const content = view.state.doc.toString()
      const lineIdx = findFragmentLine(content, detail.fragment)
      if (lineIdx == null) return
      const line = view.state.doc.line(lineIdx + 1)
      view.dispatch({
        selection: { anchor: line.from, head: line.from },
        scrollIntoView: true,
      })
      view.focus()
    }
    window.addEventListener('noteser:scroll-to-fragment', handler)
    return () => window.removeEventListener('noteser:scroll-to-fragment', handler)
  }, [])

  // Listen for the "Copy block ref" command. Only the FOCUSED editor
  // responds, so when there are two panes open the right one wins.
  useEffect(() => {
    const handler = () => {
      const view = cmRef.current?.view
      if (!view || !view.hasFocus) return
      const { head } = view.state.selection.main
      const line = view.state.doc.lineAt(head)
      // Skip empty lines — there's no anchor target to link to.
      if (line.text.trim() === '') return

      let id = extractTrailingBlockId(line.text)
      if (!id) {
        id = generateBlockId()
        const newLine = appendBlockId(line.text, id)
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: newLine },
        })
      }

      const note = useNoteStore.getState().notes.find(n => n.id === noteIdRef.current)
      const title = note?.title || 'Untitled'
      const link = buildBlockRefLink(title, id)
      // Best-effort clipboard write. Browsers without clipboard API fall
      // back to a prompt — same pattern the bug-reporter uses.
      const writeClip = async () => {
        try {
          await navigator.clipboard.writeText(link)
        } catch {
          window.prompt('Copy this block link:', link)
        }
      }
      void writeClip()
    }
    window.addEventListener('noteser:copy-block-ref', handler)
    return () => window.removeEventListener('noteser:copy-block-ref', handler)
  }, [])

  const debouncedSave = useDebouncedCallback(onSave, 300)

  // Extensions are stable (created once) — callbacks reach out to refs for fresh values
  const extensions = useMemo(() => [
    markdown({ base: markdownLanguage }),
    markdownLivePreview,
    tasksLivePreview,
    basesLivePreview,
    imagesLivePreview,
    diffGutterExtension,
    // Built-in find / replace panel. `top: true` opens it above the
    // editor — matches VS Code / Obsidian placement. Keymap includes
    // Ctrl+F (find), Ctrl+H (replace), F3/Shift+F3 (next/prev), Esc
    // (close). High precedence so noteser's own keymap doesn't shadow.
    search({ top: true }),
    Prec.highest(keymap.of([
      ...searchKeymap,
      // Obsidian binds Ctrl+H to find-and-replace. The CodeMirror panel
      // shows both find + replace inputs, so this just opens the same
      // panel as Ctrl+F.
      { key: 'Ctrl-h', preventDefault: true, run: openSearchPanel },
    ])),
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
      // Alt+L toggles the "- [ ]" task bullet (add on plain lines, remove
      // on task lines). Alt+Shift+L toggles the [x]/[ ] checkmark
      // (Obsidian-style with ✅ date stamp).
      //
      // CodeMirror's idiom for "same base key with/without Shift" is one
      // binding with both `run` (no shift) and `shift` (with shift). An
      // earlier attempt registered them as two separate bindings
      // (`Alt-l` + `Alt-Shift-l`); CodeMirror's chord resolver did NOT
      // pick the Shift variant for Alt+Shift+L and Alt-l ran on every
      // press. The `shift` field on the base binding is the documented
      // way to disambiguate. (Caught by the qa-tester sweep on
      // 2026-05-21.)
      key: 'Alt-l',
      preventDefault: true,
      run(view) {
        const { state } = view
        const { head } = state.selection.main
        const line = state.doc.lineAt(head)
        const taskMatch = line.text.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+)/)
        if (taskMatch) {
          const indent = taskMatch[1].length
          const markerLen = taskMatch[2].length
          view.dispatch({
            changes: { from: line.from + indent, to: line.from + indent + markerLen, insert: '' },
            selection: { anchor: Math.max(line.from, head - markerLen) },
          })
        } else {
          const indent = line.text.match(/^(\s*)/)![1].length
          const insertAt = line.from + indent
          view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: '- [ ] ' },
            selection: { anchor: head + 6 },
          })
        }
        return true
      },
      shift(view) {
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
    {
      // Insert a 2-row × 2-col markdown table at the cursor. Drops the
      // template on its own block (precedes with a blank line if the
      // current line isn't empty) and selects "Header 1" so the user
      // can type to overwrite.
      key: 'Mod-Alt-t',
      preventDefault: true,
      run(view) {
        const { head } = view.state.selection.main
        const line = view.state.doc.lineAt(head)
        const prefix = line.text === '' ? '' : '\n\n'
        const t = buildTable(2, 2)
        const insertPos = prefix === '' ? line.from : line.to
        const insertText = `${prefix}${t.text}`
        const baseOffset = insertPos + prefix.length
        view.dispatch({
          changes: { from: insertPos, to: insertPos, insert: insertText },
          selection: {
            anchor: baseOffset + t.selectionFrom,
            head: baseOffset + t.selectionTo,
          },
        })
        return true
      },
    },
    {
      // Tab inside a markdown table jumps to the next cell. Past the
      // last cell of the last body row a fresh row is appended. Returns
      // false (so the default Tab indentation runs) when the cursor is
      // not inside a table.
      key: 'Tab',
      preventDefault: false,
      run(view) {
        const { state } = view
        const { head } = state.selection.main
        const docLine = state.doc.lineAt(head)
        const lineIdx = docLine.number - 1
        const col = head - docLine.from
        const lines = state.doc.toString().split('\n')

        const bounds = findTableBounds(lines, lineIdx)
        if (!bounds) return false

        const cellIdx = findCellIndexAtPos(docLine.text, col)
        // Cursor on the divider row → drop into the first body cell.
        if (cellIdx == null && lineIdx !== bounds.dividerIdx) return false

        // Effective starting position when on the divider: treat it as
        // the last cell of the divider row so nextCellTarget wraps to
        // the first body row.
        let fromCellIdx = cellIdx ?? 0
        let fromLineIdx = lineIdx
        if (lineIdx === bounds.dividerIdx) {
          const divCells = findCellRanges(docLine.text).length
          fromCellIdx = Math.max(0, divCells - 1)
          fromLineIdx = bounds.dividerIdx
        }

        const target = nextCellTarget(lines, fromLineIdx, fromCellIdx, bounds)
        if (!target) return false

        if (target.appendRow) {
          // Column count for the new row: take it from the divider
          // (canonical for the table). Numbering: if every existing
          // body cell follows the `Cell N` pattern with a contiguous
          // sequence, continue it; otherwise insert an empty row.
          const cols = findCellRanges(lines[bounds.dividerIdx]).length
          const cellPattern = /^Cell (\d+)$/
          let maxN = 0
          let allMatch = true
          for (let r = bounds.bodyStartIdx; r <= bounds.bodyEndIdx; r++) {
            const ranges = findCellRanges(lines[r])
            for (const range of ranges) {
              const txt = lines[r].slice(range.contentStart, range.contentEnd)
              const m = txt.match(cellPattern)
              if (!m) { allMatch = false; break }
              const n = parseInt(m[1], 10)
              if (n > maxN) maxN = n
            }
            if (!allMatch) break
          }
          const hasBody = bounds.bodyEndIdx >= bounds.bodyStartIdx
          const newRow = buildEmptyRow(
            cols,
            allMatch && hasBody ? maxN + 1 : undefined,
          )
          // Append after the last body row (or after the divider when
          // body is empty). bodyEndIdx is already the right anchor in
          // both cases.
          const anchorLine = state.doc.line(bounds.bodyEndIdx + 1)
          const insertAt = anchorLine.to
          const insertText = `\n${newRow}`
          // Compute caret position: start of content of cell 0 in the
          // new row. The new row starts at insertAt + 1 (the newline).
          const newRowStart = insertAt + 1
          const newRanges = findCellRanges(newRow)
          const contentStart = newRowStart + (newRanges[0]?.contentStart ?? 2)
          view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: insertText },
            selection: { anchor: contentStart },
            scrollIntoView: true,
          })
          return true
        }

        const targetLineDoc = state.doc.line(target.lineIdx + 1)
        const targetLineText = targetLineDoc.text
        const ranges = findCellRanges(targetLineText)
        const range = ranges[Math.min(target.cellIdx, ranges.length - 1)]
        if (!range) return false
        const anchor = targetLineDoc.from + range.contentStart
        view.dispatch({
          selection: { anchor },
          scrollIntoView: true,
        })
        return true
      },
      shift(view) {
        const { state } = view
        const { head } = state.selection.main
        const docLine = state.doc.lineAt(head)
        const lineIdx = docLine.number - 1
        const col = head - docLine.from
        const lines = state.doc.toString().split('\n')

        const bounds = findTableBounds(lines, lineIdx)
        if (!bounds) return false

        const cellIdx = findCellIndexAtPos(docLine.text, col)
        if (cellIdx == null && lineIdx !== bounds.dividerIdx) return false

        // Cursor on the divider → treat as first cell so prev wraps to
        // the last cell of the header row.
        let fromCellIdx = cellIdx ?? 0
        let fromLineIdx = lineIdx
        if (lineIdx === bounds.dividerIdx) {
          fromCellIdx = 0
          fromLineIdx = bounds.dividerIdx
        }

        const target = prevCellTarget(lines, fromLineIdx, fromCellIdx, bounds)
        if (!target) return false

        const targetLineDoc = state.doc.line(target.lineIdx + 1)
        const targetLineText = targetLineDoc.text
        const ranges = findCellRanges(targetLineText)
        const range = ranges[Math.min(target.cellIdx, ranges.length - 1)]
        if (!range) return false
        const anchor = targetLineDoc.from + range.contentStart
        view.dispatch({
          selection: { anchor },
          scrollIntoView: true,
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
              // Strip display-text portion + extract optional #fragment.
              const target = rawTitle.split('|')[0].trim()
              const hash = target.indexOf('#')
              const title = hash === -1 ? target : target.slice(0, hash).trim()
              const fragment = hash === -1 ? null : target.slice(hash + 1).trim() || null
              const note = findNoteByTitleOrAlias(activeNotesRef.current, title)
              if (note) {
                event.preventDefault()
                navigateRef.current(note)
                if (fragment) {
                  // Defer until the new note's editor mounts.
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('noteser:scroll-to-fragment', {
                      detail: { noteId: note.id, fragment },
                    }))
                  }, 0)
                }
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

  const updateTagState = useCallback((content: string) => {
    const view = cmRef.current?.view
    if (!view) return
    // Tags and wikilinks are mutually exclusive: if we just opened the
    // wikilink popup, don't also fire the tag popup. (e.g. `[[#`)
    if (wikilinkState) { setTagState(null); return }
    const cursorPos = view.state.selection.main.head
    const active = getActiveTagQuery(content, cursorPos)
    if (!active) { setTagState(null); return }
    const coords = view.coordsAtPos(cursorPos)
    if (!coords) return
    setTagState({
      query: active.query,
      start: active.start,
      position: { top: coords.bottom + 4, left: coords.left },
    })
  }, [wikilinkState])

  const handleChange = useCallback((value: string) => {
    debouncedSave(value)
    updateWikilinkState(value)
    updateTagState(value)
  }, [debouncedSave, updateWikilinkState, updateTagState])

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

  const handleTagSelect = useCallback((tagName: string) => {
    if (!tagState) return
    const view = cmRef.current?.view
    if (!view) return
    const cursorPos = view.state.selection.main.head
    // Replace from the `#` through the cursor with `#<tag> ` (trailing
    // space so the user can continue typing immediately).
    const insertion = `#${tagName} `
    view.dispatch({
      changes: { from: tagState.start, to: cursorPos, insert: insertion },
      selection: { anchor: tagState.start + insertion.length },
    })
    setTagState(null)
    view.focus()
  }, [tagState])

  // Snapshot of all known tags across the vault. Recomputed once when
  // the editor mounts (or note switches) — collectAllTags is WeakMap-
  // cached internally, so the cost stays low at 5k+ notes.
  const allTags = useMemo(
    () => collectAllTags(useNoteStore.getState().notes),
    // `tagState` triggers a re-read so newly-typed tags become available
    // for the *next* completion. Cheap because of the per-note cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagState?.start, noteId],
  )

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
      {tagState && (
        <TagAutocomplete
          query={tagState.query}
          tags={allTags}
          position={tagState.position}
          onSelect={handleTagSelect}
          onClose={() => setTagState(null)}
        />
      )}
    </div>
  )
}
