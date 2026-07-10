import {
  Decoration, EditorView, WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import { StateField, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { toggleTaskLineText } from '@/utils/tasks'
import { matchCalloutType, CALLOUT_LABELS, CALLOUT_ICON_SHAPES, type CalloutType } from '@/utils/callouts'
import { findCellRanges } from '@/utils/markdownTable'

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

const calloutLineDecos: Record<CalloutType, Decoration> = {
  note: Decoration.line({ class: 'cm-lp-callout-line cm-lp-callout-note' }),
  tip: Decoration.line({ class: 'cm-lp-callout-line cm-lp-callout-tip' }),
  important: Decoration.line({ class: 'cm-lp-callout-line cm-lp-callout-important' }),
  warning: Decoration.line({ class: 'cm-lp-callout-line cm-lp-callout-warning' }),
  caution: Decoration.line({ class: 'cm-lp-callout-line cm-lp-callout-caution' }),
}

const SVG_NS = 'http://www.w3.org/2000/svg'

// Replaces a `[!TYPE]` marker line with an icon + label, matching the
// rendered CalloutBox (src/components/shared/CalloutBox.tsx) — same icon
// geometry from @/utils/callouts, built via the DOM API since CodeMirror
// widgets aren't React.
class CalloutLabelWidget extends WidgetType {
  constructor(readonly type: CalloutType) {
    super()
  }

  eq(other: CalloutLabelWidget): boolean {
    return other.type === this.type
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = `cm-lp-callout-label cm-lp-callout-label-${this.type}`
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '14')
    svg.setAttribute('height', '14')
    svg.classList.add('cm-lp-callout-icon')
    for (const shape of CALLOUT_ICON_SHAPES[this.type]) {
      const el = document.createElementNS(SVG_NS, shape.tag)
      for (const [k, v] of Object.entries(shape.attrs)) el.setAttribute(k, String(v))
      svg.appendChild(el)
    }
    wrap.appendChild(svg)
    const label = document.createElement('span')
    label.textContent = CALLOUT_LABELS[this.type]
    wrap.appendChild(label)
    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
}

type CellAlign = 'left' | 'center' | 'right' | null

function alignForDividerCell(text: string): CellAlign {
  const t = text.trim()
  const left = t.startsWith(':')
  const right = t.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

// Renders a GFM table (header + divider + body rows, raw source lines
// already validated by the caller) as a real `<table>` — swapped in for
// the whole block while the cursor is elsewhere. Clicking anywhere in
// the rendered table drops the cursor at the table's first line, which
// reveals the raw markdown for editing (same reveal-on-cursor pattern
// as headings/callouts, just at block granularity since column
// alignment can't be faked with inline marks on plain text).
class TableWidget extends WidgetType {
  constructor(readonly lines: readonly string[]) {
    super()
  }

  eq(other: TableWidget): boolean {
    return other.lines.length === this.lines.length &&
      other.lines.every((l, i) => l === this.lines[i])
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-lp-table-wrap'

    const headerCells = findCellRanges(this.lines[0])
      .map(r => this.lines[0].slice(r.contentStart, r.contentEnd))
    const aligns: CellAlign[] = findCellRanges(this.lines[1])
      .map(r => alignForDividerCell(this.lines[1].slice(r.contentStart, r.contentEnd)))

    const table = document.createElement('table')
    table.className = 'cm-lp-table'

    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    headerCells.forEach((text, i) => {
      const th = document.createElement('th')
      th.textContent = text
      if (aligns[i]) th.style.textAlign = aligns[i]!
      headRow.appendChild(th)
    })
    thead.appendChild(headRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (let i = 2; i < this.lines.length; i++) {
      const cells = findCellRanges(this.lines[i])
        .map(r => this.lines[i].slice(r.contentStart, r.contentEnd))
      if (cells.length === 0) continue
      const tr = document.createElement('tr')
      cells.forEach((text, ci) => {
        const td = document.createElement('td')
        td.textContent = text
        if (aligns[ci]) td.style.textAlign = aligns[ci]!
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    wrap.appendChild(table)

    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(wrap)
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      view.focus()
    })

    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
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
const tableDelim = Decoration.mark({ class: 'cm-lp-table-delim' })

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

    // ── Callout detection pass ────────────────────────────────────────────
    // A separate pass (like the #tag/list-marker passes below) because a
    // Blockquote's callout-ness depends on its very first line, which we
    // need to know before the main walk styles each QuoteMark line-by-line.
    const calloutLineTypes = new Map<number, CalloutType>()
    const calloutMarkerRanges: Array<{ from: number; to: number; type: CalloutType }> = []
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name !== 'Blockquote') return
        const startLine = doc.lineAt(node.from)
        const prefixMatch = /^(?:>\s?)+/.exec(startLine.text)
        const bodyStart = prefixMatch ? startLine.from + prefixMatch[0].length : startLine.from
        const type = matchCalloutType(doc.sliceString(bodyStart, startLine.to))
        if (!type) return
        const endLine = doc.lineAt(node.to)
        for (let n = startLine.number; n <= endLine.number; n++) calloutLineTypes.set(n, type)
        calloutMarkerRanges.push({ from: bodyStart, to: startLine.to, type })
      },
    })

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

        // ── Blockquotes (> quoted) ───────────────────────────────────────────
        if (node.name === 'QuoteMark') {
          const lineStart = doc.lineAt(node.from).from
          const lineNum = doc.lineAt(node.from).number
          const calloutType = calloutLineTypes.get(lineNum)
          specs.push([lineStart, lineStart, calloutType ? calloutLineDecos[calloutType] : lineDecos.blockquote])
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

        // ── GFM tables ───────────────────────────────────────────────────────
        // Whole-block replace with a rendered `<table>` when the cursor is
        // outside the table (column alignment can't be faked with inline
        // marks on plain text); dim the `|` delimiters instead while the
        // cursor is inside so the raw source stays fully editable.
        if (node.name === 'Table') {
          const startLine = doc.lineAt(node.from)
          const endLine = doc.lineAt(node.to)
          const withinCursor = cursorLine >= startLine.number && cursorLine <= endLine.number
          if (withinCursor) {
            for (let n = startLine.number; n <= endLine.number; n++) {
              const line = doc.line(n)
              for (let i = 0; i < line.text.length; i++) {
                if (line.text[i] === '|') specs.push([line.from + i, line.from + i + 1, tableDelim])
              }
            }
          } else {
            const lines: string[] = []
            for (let n = startLine.number; n <= endLine.number; n++) lines.push(doc.line(n).text)
            specs.push([node.from, node.to, Decoration.replace({ widget: new TableWidget(lines), block: true })])
          }
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

    // ── Callout marker widget pass ───────────────────────────────────────────
    // Swap the raw `[!TYPE]` text for an icon+label widget, same as headings
    // hide their `#` marks — but only off the cursor's line so the marker
    // stays editable as plain text while the user is on it.
    for (const { from, to, type } of calloutMarkerRanges) {
      if (doc.lineAt(from).number === cursorLine) continue
      specs.push([from, to, Decoration.replace({ widget: new CalloutLabelWidget(type) })])
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
  // Callouts (`> [!NOTE]` etc.) — colors match CalloutBox.tsx's Tailwind
  // classes (border/bg-{color}-500) so the editor and rendered preview agree.
  '.cm-lp-callout-line': { paddingLeft: '10px', borderLeft: '3px solid transparent' },
  '.cm-lp-callout-note': { borderLeftColor: '#3b82f6', background: 'rgba(59, 130, 246, 0.07)' },
  '.cm-lp-callout-tip': { borderLeftColor: '#22c55e', background: 'rgba(34, 197, 94, 0.07)' },
  '.cm-lp-callout-important': { borderLeftColor: '#a855f7', background: 'rgba(168, 85, 247, 0.07)' },
  '.cm-lp-callout-warning': { borderLeftColor: '#eab308', background: 'rgba(234, 179, 8, 0.07)' },
  '.cm-lp-callout-caution': { borderLeftColor: '#ef4444', background: 'rgba(239, 68, 68, 0.07)' },
  '.cm-lp-callout-label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontWeight: '600',
    fontStyle: 'normal',
  },
  '.cm-lp-callout-label-note': { color: '#3b82f6' },
  '.cm-lp-callout-label-tip': { color: '#22c55e' },
  '.cm-lp-callout-label-important': { color: '#a855f7' },
  '.cm-lp-callout-label-warning': { color: '#eab308' },
  '.cm-lp-callout-label-caution': { color: '#ef4444' },
  '.cm-lp-callout-icon': { flex: 'none' },
  '.cm-lp-table-delim': { color: '#6b7280', opacity: '0.6' },
  '.cm-lp-table-wrap': { display: 'block', margin: '4px 0', overflowX: 'auto', cursor: 'text' },
  '.cm-lp-table': {
    borderCollapse: 'collapse',
    fontSize: '0.92em',
    minWidth: '100%',
  },
  '.cm-lp-table th, .cm-lp-table td': {
    border: '1px solid #3a3a3a',
    padding: '4px 10px',
    textAlign: 'left',
  },
  '.cm-lp-table th': {
    background: 'rgba(255, 255, 255, 0.06)',
    fontWeight: '600',
  },
  '.cm-lp-table tbody tr:nth-child(even)': {
    background: 'rgba(255, 255, 255, 0.025)',
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
