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
  type ViewUpdate,
} from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
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

// Build a DecorationSet covering only the visible viewport. CodeMirror feeds
// the visible ranges via `view.visibleRanges`; we walk lines inside each one
// and emit at most one line decoration per list line.
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc } = view.state

  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      const width = listLinePrefixWidth(line.text)
      if (width > 0) {
        // `text-indent` only affects the FIRST visual line — that's exactly
        // the behaviour we want: cancel the padding for row 1 (so the marker
        // stays at the left margin), let rows 2+ keep the padding.
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            attributes: {
              style: `padding-left:${width}ch;text-indent:-${width}ch;`,
            },
          }),
        )
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
    decorations: v => v.decorations,
  },
)
