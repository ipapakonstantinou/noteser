// Per-line diff markers for the editor's left-gutter indicator (109).
//
// Given the current document and the last-pushed snapshot, return a
// Map<lineNumber, MarkerKind> describing what changed since the user
// last synced. Used by the CodeMirror gutter extension to render the
// VS Code-style colored bars.
//
// Marker semantics:
//   'added'    — line is new (no corresponding line in lastPushed)
//   'modified' — line exists on both sides but differs
//
// We do NOT mark deleted lines here; the gutter can't render between
// rows easily and the user wants the simple "this line changed" cue.

import { diffByLine, type DiffHunk } from './lineDiff'

export type MarkerKind = 'added' | 'modified'

// Line numbers are 1-indexed (CodeMirror convention). The map only
// includes lines that should render a marker — unmarked lines = clean.
export function computeDiffMarkers(local: string, lastPushed: string): Map<number, MarkerKind> {
  const markers = new Map<number, MarkerKind>()
  if (local === lastPushed) return markers
  // First push or unknown ancestor → don't paint everything as
  // "modified". Treat the entire doc as clean until a sync establishes
  // a baseline.
  if (!lastPushed) return markers

  const hunks = diffByLine(local, lastPushed)
  let lineNum = 1
  for (const hunk of hunks) {
    if (hunk.type === 'equal') {
      lineNum += hunk.lines.length
    } else {
      classifyHunk(hunk, lineNum, markers)
      lineNum += hunk.localLines.length
    }
  }
  return markers
}

// A change hunk paired with its starting line in `local`. Decide
// per-line whether each local line is 'added' or 'modified'.
function classifyHunk(hunk: DiffHunk, startLine: number, out: Map<number, MarkerKind>): void {
  if (hunk.type !== 'change') return
  const { localLines, remoteLines } = hunk
  // Hunk is pure-insertion → every local line is 'added'.
  if (remoteLines.length === 0) {
    for (let i = 0; i < localLines.length; i++) out.set(startLine + i, 'added')
    return
  }
  // Hunk is pure-deletion → no local lines to mark.
  if (localLines.length === 0) return
  // Mixed: lines that align with a remote line are 'modified', any
  // extras are 'added'. We don't attempt to LCS within the hunk —
  // simple positional alignment matches what VS Code shows.
  for (let i = 0; i < localLines.length; i++) {
    out.set(startLine + i, i < remoteLines.length ? 'modified' : 'added')
  }
}
