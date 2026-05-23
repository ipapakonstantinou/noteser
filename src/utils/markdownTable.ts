// Markdown table helpers.
//
// `buildTable(rows, cols)` returns a GFM-compatible table template with
// header / divider / body rows. The first header cell is named `Header 1`,
// the others numbered, so users can tab through visible text and replace.

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
