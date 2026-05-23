// Markdown table helpers.
//
// `buildTable(rows, cols)` returns a GFM-compatible table template with
// header / divider / body rows. The first header cell is named `Header 1`,
// the others numbered, so users can tab through visible text and replace.
//
// The rest of the helpers in this file support Tab / Shift-Tab navigation
// inside an already-existing markdown table.

export interface TableInsertion {
  text: string
  // Caret position (offset from the start of `text`) where the selection
  // should land after insertion. Defaults to the start of the first
  // header cell name so the user can immediately start typing the
  // column heading.
  selectionFrom: number
  selectionTo: number
}

export function buildTable(rows = 2, cols = 2): TableInsertion {
  if (rows < 1 || cols < 1) {
    return { text: '', selectionFrom: 0, selectionTo: 0 }
  }

  const headers: string[] = []
  for (let c = 0; c < cols; c++) headers.push(`Header ${c + 1}`)
  const headerRow = `| ${headers.join(' | ')} |`
  const dividerRow = `| ${headers.map(() => '---').join(' | ')} |`

  const bodyRows: string[] = []
  for (let r = 0; r < rows; r++) {
    const cells: string[] = []
    for (let c = 0; c < cols; c++) cells.push(`Cell ${r * cols + c + 1}`)
    bodyRows.push(`| ${cells.join(' | ')} |`)
  }

  const lines = [headerRow, dividerRow, ...bodyRows]
  const text = lines.join('\n')

  // Place the selection over the first header label ("Header 1") so the
  // user can type to overwrite it.
  const firstHeader = 'Header 1'
  const selectionFrom = text.indexOf(firstHeader)
  const selectionTo = selectionFrom + firstHeader.length

  return { text, selectionFrom, selectionTo }
}

// ────────────────────────────────────────────────────────────────────────
// Tab navigation helpers
// ────────────────────────────────────────────────────────────────────────

export interface TableBounds {
  headerIdx: number
  dividerIdx: number
  bodyStartIdx: number
  // Inclusive index of the last body row. Equal to `dividerIdx` when the
  // table has no body rows yet (e.g. header + divider only).
  bodyEndIdx: number
}

export interface CellRange {
  // Column index (within the line string) of the `|` that opens this cell.
  pipeStart: number
  // Column index of the `|` that closes this cell.
  pipeEnd: number
  // Column index of the first non-space character inside the cell. When
  // the cell is empty / pure whitespace this points at the position
  // immediately after the opening pipe + one space (GFM convention).
  contentStart: number
  // Column index just past the last non-space character. Equal to
  // `contentStart` for empty cells.
  contentEnd: number
}

export interface NextCellTarget {
  lineIdx: number
  cellIdx: number
  // True when the navigation must first append a new body row before
  // landing the cursor.
  appendRow: boolean
}

export interface PrevCellTarget {
  lineIdx: number
  cellIdx: number
}

// A line is treated as a table row if it contains at least one `|` and
// is not blank. We do not require the line to start with `|` so leading
// whitespace and pipeless-first-column variants still match. CodeMirror
// passes us individual line strings, so multi-line content is not a
// concern here.
export function isTableRow(line: string): boolean {
  if (line.trim() === '') return false
  return line.includes('|')
}

// GFM divider: a row of cells whose content is dashes with optional
// leading / trailing colons (alignment markers). Examples:
//   | --- | --- |
//   |:---|---:|:---:|
//   --- | ---
const DIVIDER_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

export function isDividerRow(line: string): boolean {
  if (!isTableRow(line)) return false
  return DIVIDER_RE.test(line)
}

// Walk outward from `lineIdx` to find the contiguous block of table
// rows. Returns null if the cursor's line is not a table row, or if no
// divider row exists in the block (we require a header + divider, GFM
// style, otherwise it's not a table we want to drive Tab through).
export function findTableBounds(lines: string[], lineIdx: number): TableBounds | null {
  if (lineIdx < 0 || lineIdx >= lines.length) return null
  if (!isTableRow(lines[lineIdx])) return null

  let start = lineIdx
  while (start > 0 && isTableRow(lines[start - 1])) start--

  let end = lineIdx
  while (end < lines.length - 1 && isTableRow(lines[end + 1])) end++

  // Locate the divider row inside [start, end].
  let dividerIdx = -1
  for (let i = start; i <= end; i++) {
    if (isDividerRow(lines[i])) {
      dividerIdx = i
      break
    }
  }
  if (dividerIdx === -1) return null
  // Header must sit directly above the divider.
  const headerIdx = dividerIdx - 1
  if (headerIdx < start) return null

  return {
    headerIdx,
    dividerIdx,
    bodyStartIdx: dividerIdx + 1,
    // Inclusive; when no body rows exist this is `dividerIdx` (caller
    // detects empty body by comparing bodyStartIdx > bodyEndIdx).
    bodyEndIdx: end,
  }
}

// Slice a line into its cells. We treat every `|` as a separator, so a
// row that starts/ends with `|` produces leading/trailing empty cells
// that we drop — this matches how authors think about cell count.
export function findCellRanges(line: string): CellRange[] {
  const pipes: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|') pipes.push(i)
  }
  if (pipes.length < 2) return []

  const ranges: CellRange[] = []
  for (let i = 0; i < pipes.length - 1; i++) {
    const pipeStart = pipes[i]
    const pipeEnd = pipes[i + 1]
    // Trim whitespace inside the cell to compute content bounds.
    let cs = pipeStart + 1
    let ce = pipeEnd
    while (cs < ce && line[cs] === ' ') cs++
    while (ce > cs && line[ce - 1] === ' ') ce--
    // For empty cells, point contentStart at the position one space
    // after the opening pipe (where the user would start typing in a
    // freshly built table like `| Cell 1 | Cell 2 |`).
    if (cs === ce) {
      cs = Math.min(pipeStart + 2, pipeEnd)
      ce = cs
    }
    ranges.push({ pipeStart, pipeEnd, contentStart: cs, contentEnd: ce })
  }
  return ranges
}

// Find which cell the column `col` (offset within `line`) sits in.
// Returns null when the column is before the first `|` or after the
// last `|` on the line.
export function findCellIndexAtPos(line: string, col: number): number | null {
  const ranges = findCellRanges(line)
  if (ranges.length === 0) return null
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    // A position sitting exactly on the closing pipe is still considered
    // part of this cell (so Tab from `Cell 1 |^` jumps to the next).
    if (col >= r.pipeStart && col <= r.pipeEnd) return i
  }
  return null
}

export function nextCellTarget(
  lines: string[],
  lineIdx: number,
  cellIdx: number,
  bounds: TableBounds,
): NextCellTarget | null {
  // Determine the column count for the current row to know whether we
  // can move right within the same line.
  const currentCells = findCellRanges(lines[lineIdx]).length
  if (cellIdx < currentCells - 1) {
    return { lineIdx, cellIdx: cellIdx + 1, appendRow: false }
  }

  // Need to move to the next row.
  let nextLine = lineIdx + 1
  // Skip the divider row.
  if (nextLine === bounds.dividerIdx) nextLine++

  if (nextLine > bounds.bodyEndIdx || nextLine < bounds.bodyStartIdx) {
    // Past the last body row — caller appends a new row.
    return { lineIdx: bounds.bodyEndIdx + 1, cellIdx: 0, appendRow: true }
  }
  return { lineIdx: nextLine, cellIdx: 0, appendRow: false }
}

export function prevCellTarget(
  lines: string[],
  lineIdx: number,
  cellIdx: number,
  bounds: TableBounds,
): PrevCellTarget | null {
  if (cellIdx > 0) {
    return { lineIdx, cellIdx: cellIdx - 1 }
  }

  // First cell of the row — move to the last cell of the previous row,
  // skipping the divider.
  let prevLine = lineIdx - 1
  if (prevLine === bounds.dividerIdx) prevLine--

  if (prevLine < bounds.headerIdx) {
    // Already at the first cell of the header row.
    return null
  }
  const prevCells = findCellRanges(lines[prevLine]).length
  return { lineIdx: prevLine, cellIdx: Math.max(0, prevCells - 1) }
}

// Build a fresh body row. When `startingCellNumber` is provided, the
// row reads `| Cell N | Cell N+1 | ... |` (continuing the default
// numbering from `buildTable`). Otherwise produces an empty row with
// two spaces per cell so the layout matches authored tables that use
// `|   |   |` as scaffolding.
export function buildEmptyRow(cols: number, startingCellNumber?: number): string {
  if (cols < 1) return ''
  const cells: string[] = []
  for (let c = 0; c < cols; c++) {
    if (startingCellNumber != null) {
      cells.push(`Cell ${startingCellNumber + c}`)
    } else {
      cells.push('  ')
    }
  }
  if (startingCellNumber != null) {
    return `| ${cells.join(' | ')} |`
  }
  // Empty-cell variant: `|   |   |` (two spaces between pipes).
  return `|${cells.join('|')}|`
}
