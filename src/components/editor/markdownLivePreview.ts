import {
  ViewPlugin, Decoration,
  type DecorationSet, type ViewUpdate, type EditorView,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

// Inline styles — no CSS class lookup, guaranteed to win over any theme
const lineDecos = {
  h1: Decoration.line({ attributes: { style: 'font-size:1.75em;font-weight:700;line-height:1.3' } }),
  h2: Decoration.line({ attributes: { style: 'font-size:1.4em;font-weight:700;line-height:1.35' } }),
  h3: Decoration.line({ attributes: { style: 'font-size:1.2em;font-weight:600;line-height:1.4' } }),
  h4: Decoration.line({ attributes: { style: 'font-size:1.05em;font-weight:600' } }),
}

const bold       = Decoration.mark({ attributes: { style: 'font-weight:700' } })
const italic     = Decoration.mark({ attributes: { style: 'font-style:italic' } })
const inlineCode = Decoration.mark({ attributes: { style: 'font-family:monospace;background:rgba(51,51,51,.9);border-radius:3px;padding:1px 4px;font-size:.88em' } })
const strike     = Decoration.mark({ attributes: { style: 'text-decoration:line-through;opacity:.65' } })
const hidden     = Decoration.mark({ attributes: { style: 'font-size:0;opacity:0' } })

function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  let child = node.firstChild
  while (child) {
    if (child.name === name) out.push(child)
    child = child.nextSibling
  }
  return out
}

function buildDecorations(view: EditorView): DecorationSet {
  try {
    const { doc, selection } = view.state
    const cursorLine = doc.lineAt(selection.main.head).number
    const specs: [number, number, Decoration][] = []

    syntaxTree(view.state).iterate({
      enter(node) {
        const atCursor = doc.lineAt(node.from).number === cursorLine

        if (node.name.startsWith('ATXHeading')) {
          const level = parseInt(node.name.at(-1)!)
          const lineDeco = level <= 1 ? lineDecos.h1 : level <= 2 ? lineDecos.h2 : level <= 3 ? lineDecos.h3 : lineDecos.h4
          const lineStart = doc.lineAt(node.from).from
          specs.push([lineStart, lineStart, lineDeco])
          if (!atCursor) {
            for (const m of childrenNamed(node.node, 'HeaderMark'))
              specs.push([m.from, m.to, hidden])
          }
          return false
        }

        const inlineStyle = (markName: string, contentDeco: Decoration): false => {
          const marks = childrenNamed(node.node, markName)
          if (marks.length >= 2) {
            const open = marks[0], close = marks[marks.length - 1]
            if (open.to < close.from) specs.push([open.to, close.from, contentDeco])
            if (!atCursor) {
              specs.push([open.from, open.to, hidden])
              specs.push([close.from, close.to, hidden])
            }
          }
          return false
        }

        if (node.name === 'StrongEmphasis') return inlineStyle('EmphasisMark', bold)
        if (node.name === 'Emphasis')       return inlineStyle('EmphasisMark', italic)
        if (node.name === 'InlineCode')     return inlineStyle('CodeMark', inlineCode)
        if (node.name === 'Strikethrough')  return inlineStyle('StrikethroughMark', strike)
      },
    })

    // Line decos sort before marks at same position (from===to sorts before from<to)
    specs.sort((a, b) => a[0] - b[0] || a[1] - b[1])

    const builder = new RangeSetBuilder<Decoration>()
    let lastTo = -1
    for (const [from, to, deco] of specs) {
      if (from >= lastTo) {
        builder.add(from, to, deco)
        lastTo = to
      }
    }
    return builder.finish()
  } catch (e) {
    console.error('[markdownLivePreview]', e)
    return Decoration.none
  }
}

export const markdownLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildDecorations(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged)
        this.decorations = buildDecorations(update.view)
    }
  },
  { decorations: v => v.decorations }
)
