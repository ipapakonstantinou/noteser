'use client'

import { createRoot, type Root } from 'react-dom/client'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { StateField, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { BasesBlock } from './BasesBlock'

// Inline live-preview for ```bases fences. Same shape as
// tasksLivePreview.tsx — when the cursor isn't inside the fence, the
// fence is replaced with the rendered BasesBlock; when the cursor IS
// inside, the raw source is shown so the user can edit the query.

class BasesQueryWidget extends WidgetType {
  private root: Root | null = null
  constructor(readonly source: string) { super() }
  eq(other: BasesQueryWidget): boolean { return this.source === other.source }
  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-bases-widget'
    container.addEventListener('mousedown', e => e.stopPropagation())
    this.root = createRoot(container)
    this.root.render(<BasesBlock source={this.source} />)
    return container
  }
  destroy(): void {
    const r = this.root
    this.root = null
    if (r) queueMicrotask(() => r.unmount())
  }
  ignoreEvent(): boolean { return false }
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
      if (lang !== 'bases') return false

      const startLine = doc.lineAt(node.from).number
      const endLine = doc.lineAt(node.to).number
      if (cursorLine >= startLine && cursorLine <= endLine) return false

      const body = firstChildNamed(node.node, 'CodeText')
      const source = body ? doc.sliceString(body.from, body.to) : ''
      builder.add(node.from, node.to, Decoration.replace({
        widget: new BasesQueryWidget(source),
        block: true,
      }))
      return false
    },
  })

  return builder.finish()
}

export const basesLivePreviewField = StateField.define<DecorationSet>({
  create: state => buildDecorations(state),
  update(decos, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state)
    return decos
  },
  provide: f => EditorView.decorations.from(f),
})

const basesWidgetTheme = EditorView.baseTheme({
  '.cm-bases-widget': { margin: '0.25rem 0' },
})

export const basesLivePreview: Extension = [basesLivePreviewField, basesWidgetTheme]
