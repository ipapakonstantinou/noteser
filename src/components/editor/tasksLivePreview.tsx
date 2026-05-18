'use client'

import { createRoot, type Root } from 'react-dom/client'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { StateField, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { TaskQueryBlock } from './TaskQueryBlock'

// Renders ```tasks code fences inline in the CodeMirror editor as a live
// TaskQueryBlock — Obsidian's live-preview behavior. When the cursor is on
// any line inside the fence, the widget steps aside so the user can edit
// the raw source.

class TaskQueryWidget extends WidgetType {
  private root: Root | null = null

  constructor(readonly source: string) {
    super()
  }

  eq(other: TaskQueryWidget): boolean {
    return this.source === other.source
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-tasks-widget'
    // Don't let CodeMirror's gesture handlers swallow checkbox / link clicks.
    container.addEventListener('mousedown', e => e.stopPropagation())
    this.root = createRoot(container)
    this.root.render(<TaskQueryBlock source={this.source} />)
    return container
  }

  destroy(): void {
    // Defer so React can finish the current commit before unmount.
    const root = this.root
    this.root = null
    if (root) queueMicrotask(() => root.unmount())
  }

  // Let DOM events (checkbox clicks, link clicks) reach the React tree.
  ignoreEvent(): boolean {
    return false
  }
}

function firstChildNamed(node: SyntaxNode, name: string): SyntaxNode | null {
  let c = node.firstChild
  while (c) {
    if (c.name === name) return c
    c = c.nextSibling
  }
  return null
}

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc, selection } = state
  const cursorLine = doc.lineAt(selection.main.head).number

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return
      const info = firstChildNamed(node.node, 'CodeInfo')
      if (!info) return false
      const lang = doc.sliceString(info.from, info.to).trim().toLowerCase()
      if (lang !== 'tasks') return false

      // Cursor inside the fence → raw source mode.
      const startLine = doc.lineAt(node.from).number
      const endLine = doc.lineAt(node.to).number
      if (cursorLine >= startLine && cursorLine <= endLine) return false

      const body = firstChildNamed(node.node, 'CodeText')
      const source = body ? doc.sliceString(body.from, body.to) : ''

      builder.add(node.from, node.to, Decoration.replace({
        widget: new TaskQueryWidget(source),
        block: true,
      }))
      return false
    },
  })

  return builder.finish()
}

export { TaskQueryWidget }

export const tasksLivePreviewField = StateField.define<DecorationSet>({
  create: state => buildDecorations(state),
  update(decos, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state)
    return decos
  },
  provide: f => EditorView.decorations.from(f),
})

const tasksWidgetTheme = EditorView.baseTheme({
  '.cm-tasks-widget': {
    margin: '0.25rem 0',
  },
})

export const tasksLivePreview: Extension = [tasksLivePreviewField, tasksWidgetTheme]
