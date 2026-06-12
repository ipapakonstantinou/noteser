import { EditorView } from '@codemirror/view'
import {
  foldService,
  foldGutter,
  codeFolding,
  syntaxTree,
  ensureSyntaxTree,
} from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { Tree } from '@lezer/common'

/**
 * Collapsible / foldable heading sections (Obsidian parity).
 *
 * Markdown's lezer grammar tags every heading line as `ATXHeading1`…
 * `ATXHeading6` but gives NO folding information — a heading node spans only
 * its own line, not the section beneath it. We supply a `foldService` that, for
 * a heading line, computes the section range to collapse: from the END of the
 * heading line down to JUST BEFORE the next heading whose level is `<=` this
 * one (or end-of-document). This mirrors Obsidian's "fold heading" behaviour
 * where `##` collapses everything until the next `##`/`#`, and a nested `###`
 * folds independently inside it.
 *
 * The fold is VIEW-ONLY: CodeMirror hides the lines with a replace decoration
 * layer (`codeFolding()`); the underlying markdown text is never touched, so
 * typing, saving, collab (yCollab) and the live-preview decorations are all
 * unaffected. Decorations from `markdownLivePreview` simply don't render on
 * hidden lines, and no mark decoration spans the fold boundary (the boundary
 * sits at a line end), so the two layers coexist cleanly.
 */

interface HeadingInfo {
  /** Heading level 1–6. */
  level: number
  /** Document offset of the heading's `#` marker. */
  from: number
  /** Document offset of the end of the heading line. */
  lineEnd: number
}

// Cache the heading scan per parsed Tree. `syntaxTree(state)` returns a stable
// Tree object for a given state (replaced on every edit), so a WeakMap keyed by
// the Tree makes the fold-gutter's repeated per-line queries O(1) after the
// first scan, and lets the entry be GC'd once the Tree is superseded.
const headingCache = new WeakMap<Tree, HeadingInfo[]>()

function resolveTree(state: EditorState): Tree {
  // Force a full parse so folding works for the whole document (and in headless
  // test states with no view driving incremental parsing). Falls back to the
  // partial tree if the parse times out on a very large doc.
  return ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state)
}

function collectHeadings(state: EditorState): HeadingInfo[] {
  const tree = resolveTree(state)
  const cached = headingCache.get(tree)
  if (cached) return cached

  const out: HeadingInfo[] = []
  tree.iterate({
    enter(node) {
      const m = /^ATXHeading([1-6])$/.exec(node.name)
      if (m) {
        out.push({
          level: parseInt(m[1], 10),
          from: node.from,
          lineEnd: state.doc.lineAt(node.from).to,
        })
        // Headings have no nested foldable children we care about — skip.
        return false
      }
      return undefined
    },
  })
  headingCache.set(tree, out)
  return out
}

/**
 * Fold range for the heading occupying the line `[lineStart, lineEnd]`, or
 * `null` when the line is not a heading or the section is empty.
 *
 * The range runs from the end of the heading line to just before the next
 * heading of the same-or-higher level (smaller-or-equal level number), or to
 * end-of-document for the last heading. A heading immediately followed by a
 * sibling/parent heading (no body) yields `null` so the fold arrow doesn't
 * offer a no-op fold.
 */
export function headingFoldRange(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const headings = collectHeadings(state)
  const idx = headings.findIndex((h) => h.from >= lineStart && h.from <= lineEnd)
  if (idx === -1) return null

  const current = headings[idx]
  let to = state.doc.length
  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= current.level) {
      // End at the newline before the next heading line: this swallows any
      // blank lines between the section body and the next heading, matching
      // Obsidian, and leaves the next heading line fully visible.
      to = state.doc.lineAt(headings[i].from).from - 1
      break
    }
  }

  const from = current.lineEnd
  // Empty section (next heading is the very next line, or heading is at EOF):
  // nothing to collapse.
  if (to <= from) return null
  return { from, to }
}

const headingFoldService = foldService.of(headingFoldRange)

// Chevron in the fold gutter. `open` = the section can be folded (pointing
// down); folded sections show a right-pointing chevron. Sized + padded so it
// stays a comfortable tap target on touch screens, where the thin default
// gutter is hard to hit.
function foldMarkerDOM(open: boolean): HTMLElement {
  const span = document.createElement('span')
  span.className = 'cm-heading-fold-marker'
  span.textContent = open ? '▾' : '▸' // ▾ / ▸
  span.title = open ? 'Fold heading' : 'Unfold heading'
  span.setAttribute('aria-hidden', 'true')
  return span
}

// Placeholder shown inline at the end of a folded heading line.
function foldPlaceholderDOM(_view: EditorView, onclick: (e: Event) => void): HTMLElement {
  const el = document.createElement('span')
  el.className = 'cm-heading-fold-placeholder'
  el.textContent = '⋯' // ⋯
  el.title = 'Click to unfold'
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', 'Unfold heading section')
  el.onclick = onclick
  return el
}

const foldTheme = EditorView.baseTheme({
  // Fold gutter column. Kept narrow on the desktop; the marker padding below
  // widens the touch target without widening the visible rail.
  '.cm-foldGutter': {
    minWidth: '14px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-heading-fold-marker': {
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '10px',
    lineHeight: '1',
    padding: '0 3px',
    transition: 'color 120ms ease',
    userSelect: 'none',
  },
  '.cm-heading-fold-marker:hover': {
    color: '#dadada',
  },
  // The collapsed-section indicator at the end of the heading line.
  '.cm-heading-fold-placeholder': {
    color: '#8a8a8a',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid #3a3a3a',
    borderRadius: '4px',
    margin: '0 4px',
    padding: '0 6px',
    cursor: 'pointer',
    fontSize: '0.85em',
  },
  '.cm-heading-fold-placeholder:hover': {
    background: 'rgba(255,255,255,0.12)',
    color: '#dadada',
  },
  // Touch: fatten the gutter + marker so the chevron is tappable.
  '@media (pointer: coarse)': {
    '.cm-foldGutter': { minWidth: '22px' },
    '.cm-heading-fold-marker': { fontSize: '13px', padding: '0 5px' },
  },
})

/**
 * The full folding bundle: the heading fold range provider, the fold-state
 * machinery + collapsed placeholder, the gutter chevrons, and the dark-theme
 * styling. Drop this into the editor's extension list.
 */
export const foldableHeadings = [
  headingFoldService,
  codeFolding({ placeholderDOM: foldPlaceholderDOM }),
  foldGutter({ markerDOM: foldMarkerDOM }),
  foldTheme,
]
