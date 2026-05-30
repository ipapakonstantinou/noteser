'use client'

import { useRef, type RefObject } from 'react'
import { type EditorView } from '@codemirror/view'
import { undo, redo } from '@codemirror/commands'
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  DocumentTextIcon,
  HashtagIcon,
  PaperClipIcon,
  H1Icon,
  BoldIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import { saveAttachment } from '@/utils/attachments'
import { useUIStore } from '@/stores/uiStore'
import { useKeyboardInset } from '@/hooks'

// Mobile-only formatting strip below the editor. Matches Obsidian-mobile's
// compact pill: undo / redo / [[wikilink]] / template / #tag / attach / H / B,
// with a separate keyboard-dismiss pill on the right.
//
// All button `onMouseDown` calls `preventDefault()` so the CodeMirror
// selection survives the tap — without it, focus would jump to the button
// and the selection would collapse.
//
// The whole bar lifts above the keyboard via `useKeyboardInset` so it docks
// flush above iOS Safari's input-accessory pill / Chrome Android's autofill
// row. See `src/hooks/useKeyboardInset.ts` for the math.

interface Props {
  viewRef: RefObject<EditorView | null>
}

// Wrap the current selection (or insert at cursor) with `marker` on both
// sides. If the selection already starts+ends with `marker`, strip it —
// toggle behavior matching Obsidian.
function wrapInline(view: EditorView, marker: string): void {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  let insert: string
  let anchor: number
  let head: number
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    insert = selected.slice(marker.length, selected.length - marker.length)
    anchor = from
    head = from + insert.length
  } else {
    insert = `${marker}${selected}${marker}`
    anchor = from + marker.length
    head = to + marker.length
  }
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor, head },
  })
  view.focus()
}

// Cycle the heading on the current line: none → # → ## → ### → none.
function cycleHeading(view: EditorView): void {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const m = /^(#{1,6})\s/.exec(line.text)
  const current = m ? m[1].length : 0
  const stripped = m ? line.text.slice(m[0].length) : line.text
  const nextLevel = current >= 3 ? 0 : current + 1
  const next = nextLevel === 0 ? stripped : `${'#'.repeat(nextLevel)} ${stripped}`
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: next },
  })
  view.focus()
}

// Insert `[[]]` and park the caret between the brackets — the wikilink
// autocomplete plugin then opens on the next keypress.
function insertWikilink(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  view.dispatch({
    changes: { from, to, insert: `[[${selected}]]` },
    selection: { anchor: from + 2 + selected.length },
  })
  view.focus()
}

// Insert `#` at the caret — tag autocomplete then handles the rest as the
// user types.
function insertTag(view: EditorView): void {
  const { from } = view.state.selection.main
  view.dispatch({
    changes: { from, to: from, insert: '#' },
    selection: { anchor: from + 1 },
  })
  view.focus()
}

// Drop focus from the CodeMirror contenteditable so the soft keyboard
// dismisses. Web has no direct "close keyboard" API; blurring the focused
// editable surface is the standard substitute.
function dismissKeyboard(view: EditorView | null): void {
  if (!view) return
  view.contentDOM.blur()
}

export function MobileFormattingToolbar({ viewRef }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const openModal = useUIStore(s => s.openModal)
  const keyboardInset = useKeyboardInset()

  const run = (fn: (view: EditorView) => void) => () => {
    const view = viewRef.current
    if (!view) return
    fn(view)
  }

  const preventBlur = (e: React.MouseEvent) => e.preventDefault()

  const onAttach = () => {
    fileInputRef.current?.click()
  }

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const view = viewRef.current
    if (!view) return
    const refs: string[] = []
    for (const f of Array.from(files)) {
      try {
        const path = await saveAttachment(f, f.name || 'attachment')
        const alt = (f.name || 'file').replace(/\.[^.]+$/, '')
        refs.push(`![${alt}](${path})`)
      } catch (err) {
        console.error('Mobile attach save failed', err)
      }
    }
    if (refs.length > 0) {
      const insert = refs.join('\n\n')
      const { from } = view.state.selection.main
      view.dispatch({
        changes: { from, to: from, insert },
        selection: { anchor: from + insert.length },
      })
      view.focus()
    }
    // Reset so re-picking the same file works.
    e.target.value = ''
  }

  return (
    <div
      className="md:hidden flex items-center gap-2 px-2 py-2 will-change-transform"
      style={{
        transform: keyboardInset > 0 ? `translateY(-${keyboardInset}px)` : undefined,
      }}
      data-testid="mobile-formatting-toolbar"
    >
      {/* Main pill — 8 actions side by side in a rounded container. */}
      <div className="flex-1 flex items-center justify-between gap-0.5 bg-obsidianDarkGray rounded-full px-2 py-1 border border-obsidianBorder">
        <ToolbarBtn label="Undo" onMouseDown={preventBlur} onClick={run(v => { undo(v); v.focus() })} testId="format-undo">
          <ArrowUturnLeftIcon className="w-5 h-5" />
        </ToolbarBtn>
        <ToolbarBtn label="Redo" onMouseDown={preventBlur} onClick={run(v => { redo(v); v.focus() })} testId="format-redo">
          <ArrowUturnRightIcon className="w-5 h-5" />
        </ToolbarBtn>
        <ToolbarBtn label="Wikilink" onMouseDown={preventBlur} onClick={run(insertWikilink)} testId="format-wikilink">
          {/* No native heroicon for [[ ]] — render the literal glyph so it
              reads the same way Obsidian's bar does. */}
          <span className="text-[15px] font-semibold leading-none tracking-tighter" aria-hidden="true">[ ]</span>
        </ToolbarBtn>
        <ToolbarBtn label="Insert template" onMouseDown={preventBlur} onClick={() => openModal({ type: 'template' })} testId="format-template">
          <DocumentTextIcon className="w-5 h-5" />
        </ToolbarBtn>
        <ToolbarBtn label="Tag" onMouseDown={preventBlur} onClick={run(insertTag)} testId="format-tag">
          <HashtagIcon className="w-5 h-5" />
        </ToolbarBtn>
        <ToolbarBtn label="Attach" onMouseDown={preventBlur} onClick={onAttach} testId="format-attach">
          <PaperClipIcon className="w-5 h-5" />
        </ToolbarBtn>
        <ToolbarBtn label="Heading" onMouseDown={preventBlur} onClick={run(cycleHeading)} testId="format-heading">
          <H1Icon className="w-5 h-5" />
        </ToolbarBtn>
        <ToolbarBtn label="Bold" onMouseDown={preventBlur} onClick={run(v => wrapInline(v, '**'))} testId="format-bold">
          <BoldIcon className="w-5 h-5" />
        </ToolbarBtn>
      </div>
      {/* Dismiss-keyboard pill on the right — separate so it reads as a
          distinct action (Obsidian-mobile follows the same layout). */}
      <button
        type="button"
        aria-label="Dismiss keyboard"
        title="Dismiss keyboard"
        onMouseDown={preventBlur}
        onClick={() => dismissKeyboard(viewRef.current)}
        data-testid="format-dismiss-keyboard"
        className="flex-none flex items-center justify-center w-11 h-11 rounded-full bg-obsidianDarkGray border border-obsidianBorder text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText active:bg-obsidianHighlight/60 transition-colors"
      >
        <ChevronDownIcon className="w-5 h-5" />
      </button>
      {/* Hidden file picker — driven by the paperclip button. accept covers
          the common attachment types; users can still drop unsupported files
          on desktop via the existing CodeMirror drop handler. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={onFileChosen}
      />
    </div>
  )
}

interface ToolbarBtnProps {
  label: string
  onClick: () => void
  onMouseDown: (e: React.MouseEvent) => void
  testId: string
  children: React.ReactNode
}

function ToolbarBtn({ label, onClick, onMouseDown, testId, children }: ToolbarBtnProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      onClick={onClick}
      data-testid={testId}
      // Square hit area inside the rounded pill. flex-1 + min-w-0 lets the 8
      // buttons share the pill width evenly on a narrow phone (375px), while
      // the height stays touch-friendly at 36px.
      className="flex-1 flex items-center justify-center min-w-0 h-9 rounded-full text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText active:bg-obsidianHighlight/60 transition-colors"
    >
      {children}
    </button>
  )
}
