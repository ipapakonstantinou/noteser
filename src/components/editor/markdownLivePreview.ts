import {
  Decoration, EditorView,
  type DecorationSet,
} from '@codemirror/view'
import { StateField, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/**
 * Implementation notes
 * --------------------
 * We use a `StateField` (not a `ViewPlugin`) because CodeMirror treats
 * ViewPlugin-provided decorations as "dynamic" (they are registered via a
 * function: `decorations.of(view => …)`).  Dynamic decorations are excluded
 * from the "static" layout pass, which means `Decoration.line()` — the kind
 * needed to enlarge heading lines — is silently discarded.
 *
 * A `StateField` registered with `provide: f => EditorView.decorations.from(f)`
 * inserts the `DecorationSet` as a plain value (not a function) into the
 * `EditorView.decorations` facet, so it is included in the layout pass and
 * line decorations take effect.
 *
 * CSS classes are used instead of inline styles so the browser's cascade can
 * win over any CodeMirror theme (globals.css already defines `.cm-lp-*`).
 */

// ── Line decorations (affect block/layout; MUST come from StateField) ─────────
const lineDecos = {
  h1: Decoration.line({ attributes: { class: 'cm-lp-h1' } }),
  h2: Decoration.line({ attributes: { class: 'cm-lp-h2' } }),
  h3: Decoration.line({ attributes: { class: 'cm-lp-h3' } }),
  h4: Decoration.line({ attributes: { class: 'cm-lp-h4' } }),
}

// ── Mark decorations ──────────────────────────────────────────────────────────
const bold       = Decoration.mark({ attributes: { class: 'cm-lp-bold' } })
const italic     = Decoration.mark({ attributes: { class: 'cm-lp-italic' } })
const inlineCode = Decoration.mark({ attributes: { class: 'cm-lp-code' } })
const strike     = Decoration.mark({ attributes: { class: 'cm-lp-strike' } })
const hidden     = Decoration.mark({ attributes: { class: 'cm-lp-hidden' } })

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    // Collect [from, to, deco] triples, then sort and deduplicate before
    // feeding to RangeSetBuilder (which requires sorted, non-overlapping ranges).
    const specs: [number, number, Decoration][] = []

    syntaxTree(state).iterate({
      enter(node) {
        const atCursor = doc.lineAt(node.from).number === cursorLine

        // ── Headings ─────────────────────────────────────────────────────────
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
          return false
        }

        // ── Inline emphasis ───────────────────────────────────────────────────
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

    // Sort: primary by `from`, secondary by `to` (line decos at from===to sort
    // before mark decos at same position, which is what RangeSetBuilder expects).
    specs.sort((a, b) => a[0] - b[0] || a[1] - b[1])

    const builder = new RangeSetBuilder<Decoration>()
    let lastTo = -1
    for (const [from, to, deco] of specs) {
      // Skip ranges that would overlap with the previous one
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

// ── StateField — provides decorations as a plain value (not a function) ───────
// This is critical: EditorView.decorations.from(f) inserts the DecorationSet
// directly into the decorations facet, so it participates in the layout/height
// calculation pass.  A ViewPlugin with `decorations: v => v.decorations` would
// register a *function*, which is excluded from the layout pass, silently
// dropping all Decoration.line() calls.
export const markdownLivePreview = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state)
  },
  update(decos, tr) {
    if (tr.docChanged || tr.selection) {
      return buildDecorations(tr.state)
    }
    return decos.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})
