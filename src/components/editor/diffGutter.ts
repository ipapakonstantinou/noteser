// CodeMirror gutter extension that renders VS Code-style per-line
// diff markers next to the editor (109). A green bar marks added
// lines, a yellow bar marks modified lines.
//
// The extension holds two pieces of per-editor state:
//   - `lastPushed`: snapshot string the doc is diffed against.
//   - `markers`: derived Map<lineNumber, 'added' | 'modified'>.
//
// The host (CodeMirrorEditor) is responsible for dispatching a
// `setDiffBaseline` effect whenever the active note changes (since
// the snapshot is per-note). The doc-change side updates markers
// automatically via the StateField update fn.

import { StateField, StateEffect, type Extension } from '@codemirror/state'
import { gutter, GutterMarker, EditorView } from '@codemirror/view'
import { computeDiffMarkers, computeHunkRevert, type MarkerKind } from '@/utils/diffMarkers'

interface DiffState {
  lastPushed: string
  markers: Map<number, MarkerKind>
}

const EMPTY_STATE: DiffState = { lastPushed: '', markers: new Map() }

export const setDiffBaseline = StateEffect.define<string>()

const diffStateField = StateField.define<DiffState>({
  create: () => EMPTY_STATE,
  update(prev, tr) {
    // Baseline change (user switched note or sync just landed): rebuild
    // markers from scratch against the doc.
    let lastPushed = prev.lastPushed
    let changedBaseline = false
    for (const e of tr.effects) {
      if (e.is(setDiffBaseline)) {
        lastPushed = e.value
        changedBaseline = true
      }
    }
    if (changedBaseline) {
      const markers = computeDiffMarkers(tr.state.doc.toString(), lastPushed)
      return { lastPushed, markers }
    }
    if (tr.docChanged) {
      const markers = computeDiffMarkers(tr.state.doc.toString(), lastPushed)
      return { lastPushed, markers }
    }
    return prev
  },
})

class DiffGutterMarker extends GutterMarker {
  constructor(private kind: MarkerKind) { super() }
  toDOM() {
    const el = document.createElement('div')
    el.className = `cm-diff-marker cm-diff-${this.kind}`
    // Inline styles guarantee the marker is visibly painted even if the
    // baseTheme selectors don't match CodeMirror's gutter DOM exactly
    // (saw a "0-height" visibility miss in Playwright with theme-only
    // styles). Inline beats the theme cascade reliably.
    el.style.width = '3px'
    el.style.height = '100%'
    el.style.minHeight = '1em'
    el.style.display = 'block'
    el.style.cursor = 'pointer'
    el.style.backgroundColor = this.kind === 'added' ? '#22c55e' : '#facc15'
    // VS-Code style: hovering a per-line change reveals the revert
    // affordance. The marker itself is the click target — keep it
    // narrow (3px) but widen its hit area to 6px so the cursor catches
    // on the marker even if you're a hair off.
    el.title = 'Click to revert this change to the last-pushed version'
    return el
  }
  eq(other: GutterMarker) {
    return other instanceof DiffGutterMarker && other.kind === this.kind
  }
}

const ADDED_MARKER    = new DiffGutterMarker('added')
const MODIFIED_MARKER = new DiffGutterMarker('modified')

// The gutter itself. We use the `lineMarker` API — CodeMirror calls
// it per visible line and we return the matching DiffGutterMarker or
// null. Simpler than building a RangeSet and avoids type acrobatics.
const diffGutter = gutter({
  class: 'cm-diff-gutter',
  lineMarker(view, line) {
    const state = view.state.field(diffStateField, false)
    if (!state || state.markers.size === 0) return null
    const lineNum = view.state.doc.lineAt(line.from).number
    const kind = state.markers.get(lineNum)
    if (!kind) return null
    return kind === 'added' ? ADDED_MARKER : MODIFIED_MARKER
  },
  // Re-render gutter markers whenever the diff state changes (baseline
  // updates from the host, or doc edits that recomputed the map).
  lineMarkerChange(update) {
    const prev = update.startState.field(diffStateField, false)
    const next = update.state.field(diffStateField, false)
    return prev !== next
  },
  // Per-line revert. Clicking a marker re-computes the hunk that
  // contains that line and replaces it with the baseline content.
  // The replacement is a single transaction so undo/redo works the
  // same as any other edit. Pure-insertion hunks collapse to a
  // delete (insert: '' over the line range).
  domEventHandlers: {
    click(view, line) {
      const state = view.state.field(diffStateField, false)
      if (!state || state.markers.size === 0) return false
      const lineNum = view.state.doc.lineAt(line.from).number
      if (!state.markers.has(lineNum)) return false
      const revert = computeHunkRevert(view.state.doc.toString(), state.lastPushed, lineNum)
      if (!revert) return false
      const fromLine = view.state.doc.line(revert.fromLine)
      const toLine = view.state.doc.line(revert.toLine)
      view.dispatch({
        changes: { from: fromLine.from, to: toLine.to, insert: revert.insert },
      })
      return true
    },
  },
})

// Bundled extension. Includes the StateField, the gutter, AND the
// theme rules — letting consumers just `extensions.push(diffGutterExtension)`.
export const diffGutterExtension: Extension = [
  diffStateField,
  diffGutter,
  EditorView.baseTheme({
    '.cm-diff-gutter': {
      width: '3px',
      background: 'transparent',
      // Keep the cells in normal flow so each marker stretches the
      // line height implicitly.
    },
    '.cm-diff-gutter .cm-gutterElement': {
      // Each cell is a positioning context so the marker can absolute-
      // fill it without depending on a percent height that resolves to
      // 0 when the parent has no explicit height.
      position: 'relative',
      width: '3px',
      minHeight: '1em',
    },
    '.cm-diff-marker': {
      position: 'absolute',
      inset: '0',
      width: '3px',
    },
    '.cm-diff-added': {
      backgroundColor: '#22c55e', // tailwind green-500
    },
    '.cm-diff-modified': {
      backgroundColor: '#facc15', // tailwind yellow-400
    },
  }),
]
