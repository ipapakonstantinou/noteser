import {
  Decoration, EditorView,
  type DecorationSet,
} from '@codemirror/view'
import { StateField, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/**
 * Live-preview markdown decorations.
 *
 * StateField (not ViewPlugin) so `Decoration.line()` participates in the
 * layout pass — ViewPlugin-provided decorations are registered as functions
 * and excluded from height/layout computation.
 *
 * Styles are bundled via `EditorView.baseTheme` so the extension is
 * self-contained and not dependent on globals.css load order or specificity.
 */

const lineDecos = {
  h1: Decoration.line({ class: 'cm-lp-h1' }),
  h2: Decoration.line({ class: 'cm-lp-h2' }),
  h3: Decoration.line({ class: 'cm-lp-h3' }),
  h4: Decoration.line({ class: 'cm-lp-h4' }),
  blockquote: Decoration.line({ class: 'cm-lp-blockquote' }),
  taskDone: Decoration.line({ class: 'cm-lp-task-done' }),
  list: Decoration.line({ class: 'cm-lp-list' }),
}

const bold       = Decoration.mark({ class: 'cm-lp-bold' })
const italic     = Decoration.mark({ class: 'cm-lp-italic' })
const inlineCode = Decoration.mark({ class: 'cm-lp-code' })
const strike     = Decoration.mark({ class: 'cm-lp-strike' })
const hidden     = Decoration.mark({ class: 'cm-lp-hidden' })
const listMark   = Decoration.mark({ class: 'cm-lp-list-mark' })
const taskUnchecked = Decoration.mark({ class: 'cm-lp-task-unchecked' })
const taskChecked   = Decoration.mark({ class: 'cm-lp-task-checked' })

function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  let child = node.firstChild
  while (child) {
    if (child.name === name) out.push(child)
    child = child.nextSibling
  }
  return out
}

function buildDecorations(state: EditorState): DecorationSet {
  try {
    const { doc, selection } = state
    const cursorLine = doc.lineAt(selection.main.head).number
    const specs: [number, number, Decoration][] = []

    syntaxTree(state).iterate({
      enter(node) {
        const atCursor = doc.lineAt(node.from).number === cursorLine

        // ── ATX Headings (#, ##, …) ──────────────────────────────────────────
        if (node.name.startsWith('ATXHeading')) {
          const level = parseInt(node.name.at(-1)!)
          const lineDeco =
            level <= 1 ? lineDecos.h1 :
            level <= 2 ? lineDecos.h2 :
            level <= 3 ? lineDecos.h3 : lineDecos.h4
          const lineStart = doc.lineAt(node.from).from
          specs.push([lineStart, lineStart, lineDeco])
          if (!atCursor) {
            for (const m of childrenNamed(node.node, 'HeaderMark'))
              specs.push([m.from, m.to, hidden])
          }
          // Don't return false — allow inline emphasis inside headings to style.
          return
        }

        // ── Setext Headings (Title\n=====  or  Title\n-----) ────────────────
        if (node.name === 'SetextHeading1' || node.name === 'SetextHeading2') {
          const lineDeco = node.name === 'SetextHeading1' ? lineDecos.h1 : lineDecos.h2
          const titleLine = doc.lineAt(node.from)
          specs.push([titleLine.from, titleLine.from, lineDeco])
          const underline = childrenNamed(node.node, 'HeaderMark')[0]
          if (underline) {
            const underlineLineNum = doc.lineAt(underline.from).number
            const cursorOnSetext = cursorLine === titleLine.number || cursorLine === underlineLineNum
            if (!cursorOnSetext) specs.push([underline.from, underline.to, hidden])
          }
          return
        }

        // ── Blockquotes (> quoted) ──────────────────────────────────────────
        if (node.name === 'QuoteMark') {
          const lineStart = doc.lineAt(node.from).from
          specs.push([lineStart, lineStart, lineDecos.blockquote])
          if (!atCursor) specs.push([node.from, node.to, hidden])
          return false
        }

        // ── List items (-, *, +, 1.) ────────────────────────────────────────
        if (node.name === 'ListItem') {
          const lineStart = doc.lineAt(node.from).from
          specs.push([lineStart, lineStart, lineDecos.list])
          // Don't return false — recurse so we still style the marker, tasks, inline content.
          return
        }

        if (node.name === 'ListMark') {
          specs.push([node.from, node.to, listMark])
          return false
        }

        // ── Task markers ([ ] / [x]) ───────────────────────────────────────
        if (node.name === 'TaskMarker') {
          const text = doc.sliceString(node.from, node.to)
          const checked = /\[x\]/i.test(text)
          specs.push([node.from, node.to, checked ? taskChecked : taskUnchecked])
          if (checked) {
            const lineStart = doc.lineAt(node.from).from
            specs.push([lineStart, lineStart, lineDecos.taskDone])
          }
          return false
        }

        // ── Inline emphasis ─────────────────────────────────────────────────
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

    // RangeSetBuilder needs sorted, non-overlapping ranges.
    specs.sort((a, b) => a[0] - b[0] || a[1] - b[1])

    const builder = new RangeSetBuilder<Decoration>()
    let lastFrom = -1, lastTo = -1, lastDeco: Decoration | null = null
    for (const [from, to, deco] of specs) {
      // Skip exact duplicates (e.g., two QuoteMarks on the same nested-blockquote line)
      if (from === lastFrom && to === lastTo && deco === lastDeco) continue
      if (from >= lastTo) {
        builder.add(from, to, deco)
        lastFrom = from; lastTo = to; lastDeco = deco
      }
    }
    return builder.finish()
  } catch (e) {
    console.error('[markdownLivePreview]', e)
    return Decoration.none
  }
}

export const markdownLivePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state)
  },
  update(_decos, tr) {
    // Always rebuild so async syntax-tree updates from the parser don't get missed.
    return buildDecorations(tr.state)
  },
  provide: f => EditorView.decorations.from(f),
})

const livePreviewTheme = EditorView.baseTheme({
  '.cm-lp-hidden': { fontSize: '0 !important', width: '0' },
  '.cm-lp-h1': { fontSize: '1.75em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-lp-h2': { fontSize: '1.4em',  fontWeight: '700', lineHeight: '1.35' },
  '.cm-lp-h3': { fontSize: '1.2em',  fontWeight: '600', lineHeight: '1.4' },
  '.cm-lp-h4': { fontSize: '1.05em', fontWeight: '600' },
  '.cm-lp-bold':   { fontWeight: '700' },
  '.cm-lp-italic': { fontStyle: 'italic' },
  '.cm-lp-code': {
    fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace',
    background: '#333333',
    borderRadius: '3px',
    padding: '1px 4px',
    fontSize: '0.88em',
  },
  '.cm-lp-strike': { textDecoration: 'line-through', opacity: '0.7' },
  '.cm-lp-blockquote': {
    borderLeft: '3px solid #8b6dd9',
    paddingLeft: '12px',
    fontStyle: 'italic',
    color: '#a8a8a8',
  },
  '.cm-lp-list': { paddingLeft: '4px' },
  '.cm-lp-list-mark': { color: '#8b6dd9', fontWeight: '600' },
  '.cm-lp-task-unchecked': { color: '#8b6dd9' },
  '.cm-lp-task-checked':   { color: '#8b6dd9' },
  '.cm-lp-task-done': { textDecoration: 'line-through', opacity: '0.55' },
})

export const markdownLivePreview = [markdownLivePreviewField, livePreviewTheme]
