// Soft-wrap hanging indent for markdown list lines.
//
// When a long list line (bullet "- foo", ordered "1. foo", task "- [ ] foo")
// soft-wraps, CodeMirror's default behaviour starts the wrapped continuation
// flush against column 0. That breaks the visual association with the marker.
// Obsidian's Live Preview indents the wrapped portion so it aligns with the
// START of the line body (i.e. after the marker + trailing space).
//
// This is VISUAL ONLY. The plugin never touches the source markdown — it
// emits `Decoration.line(...)` decorations carrying inline `padding-left` +
// `text-indent` styles in `ch` units. Each line gets its own width because
// markers vary (`- `, `1. `, `- [ ] `, `   - `, `10. `).
//
// CSS trick used per line:
//   padding-left: N ch
//   text-indent:  -N ch
// The first visual row gets shifted LEFT by `N` (cancelling the padding) so
// the marker stays where the user typed it; subsequent (wrapped) rows are not
// affected by `text-indent` and therefore appear indented by `N`. Net result:
// hanging indent, identical source.
//
// CONTINUATION LINES (PR #166 / Shift+Enter)
// `continueListItemParagraph` inserts a soft newline + N raw spaces so the
// next line attaches to the same list item as a CommonMark "list paragraph".
// That continuation line has NO marker — it's just whitespace + body — so the
// list-marker pass above ignores it. Without help, the raw N spaces in the
// source render at N monospace ch, but the parent's body (which lives behind
// `padding-left:Nch; text-indent:-Nch;`) is positioned at exactly Nch from
// the left padding edge. With proportional/bold rendering of the marker (e.g.
// the "[ ]" checkbox glyph) those two anchors can drift by a fraction of a
// character, leaving the continuation visually 1 char to the right of the
// parent's body start. To fix that we apply the SAME hanging-indent CSS to
// every continuation line, with width = the parent list item's marker width.
// The `text-indent:-Nch` swallows the N leading spaces in the source and the
// `padding-left:Nch` plants the body exactly where the parent's body sits.
//
// Performance: a StateField over the WHOLE document would re-scan every doc.
// Instead we run as a ViewPlugin that only iterates the VISIBLE viewport
// lines on each update, mirroring the strategy CM6 recommends for syntax-
// independent line decorations. Typing on a 5000-line doc therefore only
// touches the dozens of lines on screen, not the whole buffer.

import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate
} from '@codemirror/view'
import { RangeSetBuilder, type Extension, type Text } from '@codemirror/state'
import { splitListLine } from '@/utils/listTransforms'

// Compute the marker prefix length (in characters) for a given line of text.
// The hanging indent equals this width, so wrapped rows start where the body
// began. Returns 0 for non-list (plain) lines so they get no decoration.
//
// Exported for unit tests — keeps the plugin's per-line math testable without
// constructing a CodeMirror view.
export function listLinePrefixWidth(line: string): number {
  const p = splitListLine(line)
  if (p.kind === 'plain') return 0
  // For bullet + ordered the carrier already includes the trailing space, so
  // (indent + carrier) is the full visual prefix the body sits after.
  // For task lines the original source carries an extra "[x] " (4 chars)
  // between the carrier and the body — include that so wrapped rows align
  // with the task text, not with the checkbox glyph.
  const base = p.indent.length + p.carrier.length
  return p.kind === 'task' ? base + 4 : base
}

// If `lineNumber` (1-based) is a continuation line of an earlier list item,
// return the parent list item's marker width. Otherwise return 0.
//
// A line is a continuation when:
//   1. It parses as `kind: 'plain'` (no list marker of its own).
//   2. It starts with at least one whitespace character (CommonMark requires
//      the paragraph continuation to be indented to attach to the item).
//   3. Walking up via consecutive non-blank lines reaches a list-marker line
//      AND the current line's leading-whitespace char count is >= that
//      parent's marker width. Intermediate continuation lines (also plain,
//      also whitespace-led) are transparently walked through, so two
//      consecutive Shift+Enters share the same parent.
//   4. The chain is BROKEN by any blank line (CommonMark: blank line can end
//      a list item) or by a plain line with no leading whitespace.
//
// Exported for unit tests so callers can assert the chain logic without
// instantiating an EditorView.
export function continuationIndentWidth(doc: Text, lineNumber: number): number {
  const line = doc.line(lineNumber)
  const parts = splitListLine(line.text)
  // (1) must itself be plain — list-marker lines are handled by the marker
  // pass via `listLinePrefixWidth`.
  if (parts.kind !== 'plain') return 0
  // (2) the leading indent is the only place a continuation can attach. If
  // the rest of the line is empty (line.text === indent), treat it the same
  // as a blank line — it terminates the chain rather than extending it.
  const leadCount = parts.indent.length
  if (leadCount === 0) return 0
  if (parts.body.length === 0) return 0

  // (3) + (4) walk upward.
  for (let n = lineNumber - 1; n >= 1; n--) {
    const prev = doc.line(n)
    if (prev.text.length === 0) return 0
    const prevParts = splitListLine(prev.text)
    if (prevParts.kind !== 'plain') {
      // Hit a real list-marker line. This is the parent.
      const parentWidth = listLinePrefixWidth(prev.text)
      return leadCount >= parentWidth ? parentWidth : 0
    }
    // prev is plain. Is it itself a continuation candidate (whitespace +
    // body)? If yes, walk further up. Otherwise it's an unrelated paragraph
    // and the chain is broken.
    if (prevParts.indent.length === 0) return 0
    if (prevParts.body.length === 0) return 0
  }
  return 0
}

// Build a DecorationSet covering only the visible viewport. CodeMirror feeds
// the visible ranges via `view.visibleRanges`; we walk lines inside each one
// and emit at most one line decoration per list / continuation line.
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc } = view.state

  // The visible viewport can start partway through a list-item's continuation
  // chain (the user scrolled past the parent marker). `continuationIndentWidth`
  // walks upward in the document, not just within the viewport, so this still
  // produces the correct parent width for off-screen parents.
  const emit = (lineFrom: number, width: number): void => {
    builder.add(
      lineFrom,
      lineFrom,
      Decoration.line({
        attributes: {
          style: `padding-left:${width}ch;text-indent:-${width}ch;`
        }
      })
    )
  }

  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      const markerWidth = listLinePrefixWidth(line.text)
      if (markerWidth > 0) {
        // `text-indent` only affects the FIRST visual line — that's exactly
        // the behaviour we want: cancel the padding for row 1 (so the marker
        // stays at the left margin), let rows 2+ keep the padding.
        emit(line.from, markerWidth)
      } else {
        const contWidth = continuationIndentWidth(doc, line.number)
        if (contWidth > 0) emit(line.from, contWidth)
      }
      if (line.to + 1 > to) break
      pos = line.to + 1
    }
  }

  return builder.finish()
}

// ViewPlugin lifecycle: rebuild decorations on viewport scroll, doc edits, and
// geometry changes (e.g. window resize, which can change which lines are
// visible). Cheap because we only iterate visible lines.
class HangingIndentPlugin implements PluginValue {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.decorations = buildDecorations(update.view)
    }
  }
}

export const hangingIndentExtension: Extension = ViewPlugin.fromClass(
  HangingIndentPlugin,
  {
    decorations: v => v.decorations
  }
)
