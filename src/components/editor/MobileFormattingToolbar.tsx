'use client'

import { type RefObject } from 'react'
import { type EditorView } from '@codemirror/view'
import {
  BoldIcon,
  ItalicIcon,
  H1Icon,
  ListBulletIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

// Mobile-only formatting strip below the editor. Phones don't have
// keyboard shortcuts for **bold** / _italic_ / lists, so the toolbar
// keeps the touch path equivalent.
//
// All actions dispatch a single CodeMirror transaction. The button
// `onMouseDown` calls `preventDefault()` to keep CodeMirror's focus —
// without that, tapping the button steals focus and the selection
// collapses to a point.

interface Props {
  viewRef: RefObject<EditorView | null>
}

// Wrap the current selection (or insert at cursor) with `marker` on
// both sides. If the selection already starts+ends with `marker`,
// strip it instead — toggle behavior, matching how Obsidian's mobile
// toolbar feels.
function wrapInline(view: EditorView, marker: string): void {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  let insert: string
  let anchor: number
  let head: number
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    // Toggle off.
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

// Prepend `prefix` to each selected line. Cycles through removal if
// every line already has the exact prefix — same toggle feel.
function togglePrefix(view: EditorView, prefix: string): void {
  const { from, to } = view.state.selection.main
  const startLine = view.state.doc.lineAt(from)
  const endLine = view.state.doc.lineAt(to)
  const lines: string[] = []
  for (let n = startLine.number; n <= endLine.number; n++) {
    lines.push(view.state.doc.line(n).text)
  }
  const allHave = lines.every(l => l.startsWith(prefix))
  const next = allHave
    ? lines.map(l => l.slice(prefix.length)).join('\n')
    : lines.map(l => `${prefix}${l}`).join('\n')
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert: next },
  })
  view.focus()
}

// Cycle the heading on the current line: none → # → ## → ### → none.
// Single-line scope — multi-line heading toggles aren't meaningful.
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

export function MobileFormattingToolbar({ viewRef }: Props) {
  const run = (fn: (view: EditorView) => void) => () => {
    const view = viewRef.current
    if (!view) return
    fn(view)
  }
  const preventBlur = (e: React.MouseEvent) => e.preventDefault()
  return (
    <div
      className="md:hidden flex items-center justify-around gap-1 px-2 py-1.5 border-t border-obsidianBorder bg-obsidianBlack"
      data-testid="mobile-formatting-toolbar"
    >
      <ToolbarBtn label="Bold" onMouseDown={preventBlur} onClick={run(v => wrapInline(v, '**'))} testId="format-bold">
        <BoldIcon className="w-5 h-5" />
      </ToolbarBtn>
      <ToolbarBtn label="Italic" onMouseDown={preventBlur} onClick={run(v => wrapInline(v, '_'))} testId="format-italic">
        <ItalicIcon className="w-5 h-5" />
      </ToolbarBtn>
      <ToolbarBtn label="Heading" onMouseDown={preventBlur} onClick={run(cycleHeading)} testId="format-heading">
        <H1Icon className="w-5 h-5" />
      </ToolbarBtn>
      <ToolbarBtn label="Bullet" onMouseDown={preventBlur} onClick={run(v => togglePrefix(v, '- '))} testId="format-bullet">
        <ListBulletIcon className="w-5 h-5" />
      </ToolbarBtn>
      <ToolbarBtn label="Task" onMouseDown={preventBlur} onClick={run(v => togglePrefix(v, '- [ ] '))} testId="format-task">
        <CheckCircleIcon className="w-5 h-5" />
      </ToolbarBtn>
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
      className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-obsidianSecondaryText hover:bg-obsidianHighlight/40 hover:text-obsidianText active:bg-obsidianHighlight/60 transition-colors"
    >
      {children}
    </button>
  )
}
