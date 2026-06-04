import {
  Decoration, EditorView,
  type DecorationSet,
} from '@codemirror/view'
import { StateField, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { toggleTaskLineText } from '@/utils/tasks'

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
const inlineTag  = Decoration.mark({ class: 'cm-lp-tag' })

// Match Obsidian-style #tags: hash + [A-Za-z0-9_/-]+, NOT preceded by a word
// character (so we don't accidentally style `foo#bar`). We run this in a
// scanning pass over the document content; tag spans are mark decorations,
// not block ones.
const TAG_RE = /(^|[^\w#/-])(#[A-Za-z0-9_/-]+)(?![\w/-])/g

// Bullet (`-` `*` `+`) or ordered (`1.`, `2)`) list marker at line start,
// optionally indented, followed by whitespace OR end of line. Captures the
// indent in group 1 and the marker chars in group 2.
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)])(?=[ \t]|$)/

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
    // Line numbers covered by a fenced/indented/HTML code block — the fallback
    // list-marker pass below skips these so `    1. ` inside code doesn't get
    // styled as a list item.
    const codeBlockLines = new Set<number>()

    syntaxTree(state).iterate({
      enter(node) {
        if (
          node.name === 'FencedCode' ||
          node.name === 'CodeBlock' ||
          node.name === 'HTMLBlock'
        ) {
          const from = doc.lineAt(node.from).number
          const to = doc.lineAt(node.to).number
          for (let i = from; i <= to; i++) codeBlockLines.add(i)
          return false
        }

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

    // ── #tag pass ──────────────────────────────────────────────────────────
    // Scan the document text for Obsidian-style tags. We do this outside the
    // syntax-tree walk because the markdown grammar doesn't have a tag node.
    const text = doc.toString()
    let m: RegExpExecArray | null
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(text)) !== null) {
      const tagStart = m.index + m[1].length
      const tagEnd = tagStart + m[2].length
      specs.push([tagStart, tagEnd, inlineTag])
    }

    // ── List-marker fallback pass ──────────────────────────────────────────
    // lezer-markdown only tags a line as a ListItem once it has content after
    // the marker. So `1. ` (just typed the space, no body yet) goes
    // un-styled. We pattern-match every non-code line for a leading list
    // marker and add the same line/mark decorations; the dedup at the end
    // drops these as duplicates when the parser has already caught up.
    for (let i = 1; i <= doc.lines; i++) {
      if (codeBlockLines.has(i)) continue
      const line = doc.line(i)
      const lm = LIST_MARKER_RE.exec(line.text)
      if (!lm) continue
      const markerStart = line.from + lm[1].length
      const markerEnd = markerStart + lm[2].length
      specs.push([line.from, line.from, lineDecos.list])
      specs.push([markerStart, markerEnd, listMark])
    }

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
    // Code font slot (fnt1) — inline code inside the live-preview editor.
    fontFamily: 'var(--font-mono, ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace)',
    background: '#333333',
    borderRadius: '3px',
    padding: '1px 4px',
    fontSize: '0.88em',
  },
  '.cm-lp-strike': { textDecoration: 'line-through', opacity: '0.7' },
  '.cm-lp-blockquote': {
    // Left bar removed per user feedback (2026-06-04, option 2γ).
    // Italic + dim colour still differentiates quoted content; the
    // 3px blue accent read as visual noise.
    paddingLeft: '12px',
    fontStyle: 'italic',
    color: '#a8a8a8',
  },
  '.cm-lp-list': { paddingLeft: '4px' },
  // Blue restored (user feedback 2026-06-04, round 2: "why these are
  // not blue anymore? I liked the blue in these"). The earlier mute
  // was a misdiagnosis — the "blue line" Jon was seeing was actually
  // the cm-activeLineGutter highlight (now overridden in globals.css),
  // not these inline list/task glyphs. The brackets + bullet markers
  // get their accent colour back.
  '.cm-lp-list-mark': { color: 'hsl(217, 88%, 50%)', fontWeight: '600' },
  '.cm-lp-task-unchecked': { color: 'hsl(217, 88%, 50%)', cursor: 'pointer' },
  '.cm-lp-task-checked':   { color: 'hsl(217, 88%, 50%)', cursor: 'pointer' },
  '.cm-lp-task-done': { textDecoration: 'line-through', opacity: '0.55' },
  '.cm-lp-tag': {
    color: 'hsl(217, 88%, 50%)',
    background: 'hsla(217, 88%, 50%, 0.1)',
    borderRadius: '3px',
    padding: '0 3px',
    fontWeight: '500',
  },
})

// Click on a `[ ]` / `[x]` marker in the editor → toggle the task and stamp/
// strip the ✅ date. Matches Obsidian's live-preview behavior.
const taskMarkerClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
    const target = event.target as HTMLElement | null
    const marker = target?.closest?.('.cm-lp-task-unchecked, .cm-lp-task-checked') as HTMLElement | null
    if (!marker) return false
    let pos: number
    try {
      pos = view.posAtDOM(marker)
    } catch {
      return false
    }
    const line = view.state.doc.lineAt(pos)
    const newLine = toggleTaskLineText(line.text)
    if (newLine == null || newLine === line.text) return false
    view.dispatch({ changes: { from: line.from, to: line.to, insert: newLine } })
    event.preventDefault()
    return true
  },
})

export const markdownLivePreview = [markdownLivePreviewField, livePreviewTheme, taskMarkerClickHandler]
