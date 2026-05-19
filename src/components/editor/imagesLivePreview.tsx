'use client'

import { createRoot, type Root } from 'react-dom/client'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { StateField, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { AttachmentImage } from './AttachmentImage'
import { isAttachmentPath } from '@/utils/attachments'

// Renders ![alt](attachments/...) image references inline inside the
// CodeMirror editor, swapping the raw markdown for the resolved blob URL.
// Obsidian-style cursor dodge: when the cursor is on the image's line, the
// widget steps aside so the user can edit the raw text.

class AttachmentImageWidget extends WidgetType {
  private root: Root | null = null

  constructor(readonly src: string, readonly alt: string) {
    super()
  }

  eq(other: AttachmentImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt
  }

  toDOM(): HTMLElement {
    const container = document.createElement('span')
    container.className = 'cm-lp-image'
    // Don't let CodeMirror's gesture handlers swallow image-area clicks (e.g.
    // for future right-click context menus or alt-text reveal).
    container.addEventListener('mousedown', e => e.stopPropagation())
    this.root = createRoot(container)
    this.root.render(<AttachmentImage src={this.src} alt={this.alt} />)
    return container
  }

  destroy(): void {
    // Defer so React can finish the current commit before unmount.
    const root = this.root
    this.root = null
    if (root) queueMicrotask(() => root.unmount())
  }

  // Let DOM events reach the React tree (img onload, future right-click, …).
  ignoreEvent(): boolean {
    return false
  }
}

// Parse an Image node's source range into { alt, src }. Only handles the
// single-line standard form `![alt](src)` with no whitespace in src.
// Returns null for anything else so we leave it as-is.
export function parseInlineImage(text: string): { alt: string; src: string } | null {
  const m = text.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)
  if (!m) return null
  return { alt: m[1], src: m[2] }
}

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc, selection } = state
  const cursorLine = doc.lineAt(selection.main.head).number

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Image') return
      const startLine = doc.lineAt(node.from).number
      const endLine = doc.lineAt(node.to).number
      // Cursor on the image's line → render the raw markdown so the user
      // can edit the alt text / URL.
      if (cursorLine >= startLine && cursorLine <= endLine) return false

      const raw = doc.sliceString(node.from, node.to)
      const parsed = parseInlineImage(raw)
      if (!parsed) return false
      // Only swap our own attachment refs — leave external URLs (http, data:)
      // and unknown schemes as plain markdown so we don't surprise the user.
      if (!isAttachmentPath(parsed.src)) return false

      builder.add(node.from, node.to, Decoration.replace({
        widget: new AttachmentImageWidget(parsed.src, parsed.alt),
      }))
      return false
    },
  })

  return builder.finish()
}

export const imagesLivePreviewField = StateField.define<DecorationSet>({
  create: state => buildDecorations(state),
  update(decos, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state)
    return decos
  },
  provide: f => EditorView.decorations.from(f),
})

const imagesWidgetTheme = EditorView.baseTheme({
  '.cm-lp-image': {
    display: 'inline-block',
    verticalAlign: 'middle',
    margin: '0.25rem 0',
  },
  '.cm-lp-image img': {
    maxHeight: '300px',
    maxWidth: '100%',
    borderRadius: '4px',
  },
})

export const imagesLivePreview: Extension = [imagesLivePreviewField, imagesWidgetTheme]
