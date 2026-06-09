/**
 * markdownTableGaps.test.ts
 *
 * Edge-case coverage for src/utils/markdownTable.ts beyond what
 * markdownTable.test.ts already covers.
 *
 * Gaps addressed:
 *   1. findTableBounds — table preceded by a divider (wrong header assumption),
 *      table at the very start of the lines array (headerIdx = 0),
 *      single-body-row table, lineIdx out-of-range (-1, length),
 *      lineIdx at the divider row itself
 *   2. findCellRanges — line with a single pipe (returns []),
 *      pipe at very start and end, cell with only whitespace,
 *      line with only two adjacent pipes
 *   3. findCellIndexAtPos — column exactly on the opening pipe,
 *      column exactly on the closing pipe
 *   4. nextCellTarget — header-only table (bodyStartIdx > bodyEndIdx),
 *      moving from the last cell of the HEADER row (skips divider)
 *   5. prevCellTarget — at header row cell 0 → null,
 *      from first body row when body == divider + 1 (skips divider)
 *   6. buildEmptyRow — 1-column variants
 *   7. isDividerRow — edge: minimum valid divider (---)
 */

import {
  buildEmptyRow,
  buildTable,
  findCellIndexAtPos,
  findCellRanges,
  findTableBounds,
  isDividerRow,
  isTableRow,
  nextCellTarget,
  prevCellTarget,
} from '../utils/markdownTable'

// ══════════════════════════════════════════════════════════════════════════════
// 1. findTableBounds — additional edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe('findTableBounds — additional edge cases', () => {
  test('returns null when lineIdx is -1 (out of range below)', () => {
    const lines = ['| H1 |', '| --- |', '| C1 |']
    expect(findTableBounds(lines, -1)).toBeNull()
  })

  test('returns null when lineIdx equals lines.length (out of range above)', () => {
    const lines = ['| H1 |', '| --- |', '| C1 |']
    expect(findTableBounds(lines, lines.length)).toBeNull()
  })

  test('table starting at index 0 (no preceding lines)', () => {
    const lines = ['| H1 | H2 |', '| --- | --- |', '| C1 | C2 |']
    const bounds = findTableBounds(lines, 0)
    expect(bounds).not.toBeNull()
    expect(bounds!.headerIdx).toBe(0)
    expect(bounds!.dividerIdx).toBe(1)
    expect(bounds!.bodyStartIdx).toBe(2)
    expect(bounds!.bodyEndIdx).toBe(2)
  })

  test('single-body-row table has bodyEndIdx === bodyStartIdx', () => {
    const lines = ['| H |', '| --- |', '| C |']
    const bounds = findTableBounds(lines, 1)
    expect(bounds!.bodyStartIdx).toBe(bounds!.bodyEndIdx)
    expect(bounds!.bodyStartIdx).toBe(2)
  })

  test('lineIdx at the divider row returns valid bounds', () => {
    const lines = ['| H1 | H2 |', '| --- | --- |', '| C1 | C2 |']
    const bounds = findTableBounds(lines, 1)  // divider row
    expect(bounds).not.toBeNull()
    expect(bounds!.dividerIdx).toBe(1)
    expect(bounds!.headerIdx).toBe(0)
  })

  test('returns null when divider is the very first row (no header above it)', () => {
    // If the divider is at index 0, headerIdx = -1 < start → null.
    const lines = ['| --- | --- |', '| C1 | C2 |']
    expect(findTableBounds(lines, 0)).toBeNull()
  })

  test('large table: bounds from any row converge to same result', () => {
    const lines = [
      '| H1 | H2 |',
      '| --- | --- |',
      '| R1C1 | R1C2 |',
      '| R2C1 | R2C2 |',
      '| R3C1 | R3C2 |',
    ]
    const fromHeader = findTableBounds(lines, 0)
    const fromBody   = findTableBounds(lines, 4)
    expect(fromHeader).toEqual(fromBody)
    expect(fromHeader!.headerIdx).toBe(0)
    expect(fromHeader!.bodyEndIdx).toBe(4)
  })

  test('non-table line immediately after the table → only the table rows included', () => {
    const lines = [
      '| H |',
      '| --- |',
      '| C |',
      'not a table row',
      '| Other | Table |',
      '| --- | --- |',
    ]
    // From index 2 (body of first table): should NOT include lines 4-5.
    const bounds = findTableBounds(lines, 2)
    expect(bounds!.bodyEndIdx).toBe(2)  // last row of the first table only
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. findCellRanges — edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe('findCellRanges — edge cases', () => {
  test('line with only one pipe returns [] (need at least two pipes to form a cell)', () => {
    // One pipe → no cell pairs → []
    expect(findCellRanges('just | one pipe')).toEqual([])
    // No pipes → [] too
    expect(findCellRanges('nopipe')).toEqual([])
    // Two pipes → one cell range
    expect(findCellRanges('| content |')).toHaveLength(1)
  })

  test('two adjacent pipes || produce one empty cell', () => {
    const ranges = findCellRanges('||')
    expect(ranges).toHaveLength(1)
    expect(ranges[0].contentStart).toBe(ranges[0].contentEnd)
  })

  test('| pipe-only | returns one cell whose content range is empty', () => {
    // `|   |` → one cell with whitespace-only content → contentStart = contentEnd
    const line = '|   |'
    const ranges = findCellRanges(line)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].contentStart).toBe(ranges[0].contentEnd)
  })

  test('three-column row returns 3 ranges', () => {
    const line = '| A | B | C |'
    const ranges = findCellRanges(line)
    expect(ranges).toHaveLength(3)
    expect(line.slice(ranges[0].contentStart, ranges[0].contentEnd)).toBe('A')
    expect(line.slice(ranges[1].contentStart, ranges[1].contentEnd)).toBe('B')
    expect(line.slice(ranges[2].contentStart, ranges[2].contentEnd)).toBe('C')
  })

  test('cell content with extra internal spaces: contentStart/End bound the non-space run', () => {
    const line = '|  value  | other |'
    const ranges = findCellRanges(line)
    expect(line.slice(ranges[0].contentStart, ranges[0].contentEnd)).toBe('value')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. findCellIndexAtPos — boundary positions
// ══════════════════════════════════════════════════════════════════════════════

describe('findCellIndexAtPos — boundary positions', () => {
  const line = '| A | B |'
  //            0123456789
  //            |         = position 0
  //            A         = position 2
  //            |         = position 4 (between cells)
  //            B         = position 6
  //            |         = position 8 (trailing pipe)

  test('position on the opening pipe of a cell returns cell 0', () => {
    expect(findCellIndexAtPos(line, 0)).toBe(0)
  })

  test('position inside the first cell content returns cell 0', () => {
    expect(findCellIndexAtPos(line, 2)).toBe(0)
  })

  test('position on the closing pipe of cell 0 returns cell 0', () => {
    // pipeEnd of cell 0 is at position 4; col===pipeEnd → still cell 0.
    expect(findCellIndexAtPos(line, 4)).toBe(0)
  })

  test('position inside the second cell content returns cell 1', () => {
    expect(findCellIndexAtPos(line, 6)).toBe(1)
  })

  test('position past the last pipe returns null', () => {
    expect(findCellIndexAtPos(line, line.length)).toBeNull()
  })

  test('no pipes → null for any position', () => {
    expect(findCellIndexAtPos('no pipes here', 3)).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. nextCellTarget — header-only table + wrapping from header last cell
// ══════════════════════════════════════════════════════════════════════════════

describe('nextCellTarget — header-only table', () => {
  // A table with no body rows: bodyStartIdx > bodyEndIdx
  const lines = ['| H1 | H2 |', '| --- | --- |']
  const bounds = findTableBounds(lines, 0)!  // guaranteed non-null

  test('from last cell of header in a header-only table → appendRow', () => {
    // The header has 2 cells (indices 0 and 1). From cell 1 at lineIdx 0:
    // nextLine would be 1 (divider), which we skip to 2, which is > bodyEndIdx
    // (bodyEndIdx = dividerIdx = 1, bodyStartIdx = 2). → appendRow.
    const target = nextCellTarget(lines, 0, 1, bounds)
    expect(target).not.toBeNull()
    expect(target!.appendRow).toBe(true)
  })

  test('from first cell of header → second cell (same row)', () => {
    const target = nextCellTarget(lines, 0, 0, bounds)
    expect(target).toEqual({ lineIdx: 0, cellIdx: 1, appendRow: false })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. prevCellTarget — boundary behaviour
// ══════════════════════════════════════════════════════════════════════════════

describe('prevCellTarget — boundary behaviour', () => {
  const lines = [
    '| H1 | H2 |',
    '| --- | --- |',
    '| C1 | C2 |',
  ]
  const bounds = findTableBounds(lines, 0)!

  test('from cell 0 of the header row → null (already at the beginning)', () => {
    expect(prevCellTarget(lines, 0, 0, bounds)).toBeNull()
  })

  test('from cell 1 of the header row → cell 0 of the header row', () => {
    expect(prevCellTarget(lines, 0, 1, bounds)).toEqual({ lineIdx: 0, cellIdx: 0 })
  })

  test('from cell 0 of the first body row → last header cell (skips divider)', () => {
    const target = prevCellTarget(lines, 2, 0, bounds)
    expect(target).not.toBeNull()
    // Skips divider at index 1, lands on header (index 0), last cell.
    expect(target!.lineIdx).toBe(0)
    const headerCells = findCellRanges(lines[0]).length
    expect(target!.cellIdx).toBe(headerCells - 1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. buildEmptyRow — 1-column
// ══════════════════════════════════════════════════════════════════════════════

describe('buildEmptyRow — 1-column', () => {
  test('1 column numbered starting at 1', () => {
    expect(buildEmptyRow(1, 1)).toBe('| Cell 1 |')
  })

  test('1 column with no number → empty scaffold', () => {
    expect(buildEmptyRow(1)).toBe('|  |')
  })

  test('0 columns returns empty string regardless of startingCellNumber', () => {
    expect(buildEmptyRow(0, 5)).toBe('')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. isDividerRow — edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe('isDividerRow — edge cases', () => {
  test('minimum valid divider (three dashes, two pipes) is recognised', () => {
    expect(isDividerRow('| --- |')).toBe(true)
  })

  test('divider without outer pipes (pipeless-first-column variant)', () => {
    // DIVIDER_RE allows optional outer pipes; `--- | ---` should match.
    expect(isDividerRow('--- | ---')).toBe(true)
  })

  test('dashes shorter than 3 (--) are NOT a valid divider', () => {
    // `--` has only 2 dashes; DIVIDER_RE requires {3,}
    expect(isDividerRow('| -- | -- |')).toBe(false)
  })

  test('blank line is not a divider', () => {
    expect(isDividerRow('')).toBe(false)
    expect(isDividerRow('   ')).toBe(false)
  })

  test('divider with content mixed in is not valid', () => {
    expect(isDividerRow('| --- | abc |')).toBe(false)
  })

  test('many dashes is still a valid divider', () => {
    expect(isDividerRow('| ---------- | --------- |')).toBe(true)
  })
})
