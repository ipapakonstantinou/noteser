/**
 * markdownTableEdgeCases.test.ts
 *
 * Additional edge-case coverage for the markdown table navigation helpers
 * (src/utils/markdownTable.ts) that the original markdownTable.test.ts
 * does not exercise:
 *
 *   1. Header-only table (no body rows): Tab from last header cell should
 *      signal appendRow=true.
 *   2. Single-column table: Tab/Shift-Tab should still work correctly —
 *      the single cell is both the first AND last on the row.
 *   3. Divider-row Tab: cursor on the divider jumps to the first body cell.
 *   4. Divider-row Shift-Tab: jumps to the last header cell.
 *   5. Shift-Tab at the first cell of the header: returns null (nowhere to go).
 *   6. Tab past last cell of last body row: appendRow=true + correct target line.
 *   7. findCellIndexAtPos edge: cursor exactly on the closing pipe vs. just past.
 *   8. buildEmptyRow with 1 column.
 *   9. findTableBounds: divider not immediately below header is still accepted
 *      (defensive: we only require header at dividerIdx-1 and within the block).
 *  10. nextCellTarget when the current row has FEWER cells than the divider
 *      (mismatched column count — real-world tables can have this).
 */

import {
  findTableBounds,
  findCellRanges,
  findCellIndexAtPos,
  nextCellTarget,
  prevCellTarget,
  buildEmptyRow,
  isDividerRow,
} from '../utils/markdownTable'

// ── 1. Header-only table ────────────────────────────────────────────────────

describe('header-only table (no body rows)', () => {
  const lines = [
    '| Header 1 | Header 2 |',
    '| --- | --- |',
  ]
  const bounds = findTableBounds(lines, 0)!

  test('findTableBounds reports bodyEndIdx < bodyStartIdx for no-body table', () => {
    expect(bounds).not.toBeNull()
    // bodyStartIdx = 2, bodyEndIdx = 1 (dividerIdx) → body is empty
    expect(bounds.bodyStartIdx).toBeGreaterThan(bounds.bodyEndIdx)
  })

  test('Tab from first header cell → second header cell', () => {
    const target = nextCellTarget(lines, 0, 0, bounds)
    expect(target).toEqual({ lineIdx: 0, cellIdx: 1, appendRow: false })
  })

  test('Tab from last header cell → appendRow=true (body is empty)', () => {
    // Last header cell is cell 1 on line 0.
    const target = nextCellTarget(lines, 0, 1, bounds)
    expect(target).not.toBeNull()
    expect(target!.appendRow).toBe(true)
  })

  test('Shift-Tab from last header cell → first header cell', () => {
    const target = prevCellTarget(lines, 0, 1, bounds)
    expect(target).toEqual({ lineIdx: 0, cellIdx: 0 })
  })

  test('Shift-Tab from first header cell → null (nowhere to go)', () => {
    const target = prevCellTarget(lines, 0, 0, bounds)
    expect(target).toBeNull()
  })
})

// ── 2. Single-column table ──────────────────────────────────────────────────

describe('single-column table', () => {
  const lines = [
    '| Title |',
    '| --- |',
    '| Row 1 |',
    '| Row 2 |',
  ]
  const bounds = findTableBounds(lines, 0)!

  test('findTableBounds succeeds for a single-column table', () => {
    expect(bounds).not.toBeNull()
    expect(bounds.headerIdx).toBe(0)
    expect(bounds.dividerIdx).toBe(1)
  })

  test('findCellRanges returns 1 cell for a single-column row', () => {
    expect(findCellRanges('| Title |')).toHaveLength(1)
    expect(findCellRanges('| --- |')).toHaveLength(1)
  })

  test('isDividerRow matches a single-column divider', () => {
    expect(isDividerRow('| --- |')).toBe(true)
  })

  test('Tab from the single header cell → first body cell (skips divider)', () => {
    const target = nextCellTarget(lines, 0, 0, bounds)
    expect(target).toEqual({ lineIdx: 2, cellIdx: 0, appendRow: false })
  })

  test('Tab from last body cell → appendRow=true', () => {
    const target = nextCellTarget(lines, 3, 0, bounds)
    expect(target).not.toBeNull()
    expect(target!.appendRow).toBe(true)
  })

  test('Shift-Tab from first body cell → last header cell', () => {
    const target = prevCellTarget(lines, 2, 0, bounds)
    expect(target).toEqual({ lineIdx: 0, cellIdx: 0 })
  })

  test('Shift-Tab from header cell → null', () => {
    const target = prevCellTarget(lines, 0, 0, bounds)
    expect(target).toBeNull()
  })
})

// ── 3. Tab from divider row ─────────────────────────────────────────────────
//
// When the cursor is on the divider, the editor treats it as if it were
// the last cell of the header row (nextCellTarget is called with
// fromLineIdx = dividerIdx and fromCellIdx = divCells - 1).

describe('Tab/Shift-Tab when cursor is on the divider row', () => {
  const lines = [
    '| H1 | H2 |',
    '| --- | --- |',
    '| A | B |',
  ]
  const bounds = findTableBounds(lines, 1)!

  test('Tab from divider (treated as last header cell) → first body cell', () => {
    // divider has 2 cells; fromCellIdx = 1 (last cell)
    const divCells = findCellRanges(lines[1]).length
    const fromCellIdx = Math.max(0, divCells - 1)
    const target = nextCellTarget(lines, bounds.dividerIdx, fromCellIdx, bounds)
    expect(target).toEqual({ lineIdx: 2, cellIdx: 0, appendRow: false })
  })

  test('Shift-Tab from divider (treated as first cell) → last header cell', () => {
    const target = prevCellTarget(lines, bounds.dividerIdx, 0, bounds)
    expect(target).toEqual({ lineIdx: 0, cellIdx: 1 })
  })
})

// ── 4. findCellIndexAtPos boundary: cursor exactly on the closing pipe ──────

describe('findCellIndexAtPos boundary conditions', () => {
  const line = '| Cell 1 | Cell 2 |'
  //                    9         18
  // pipe positions: 0, 9, 18

  test('cursor on the closing pipe of cell 0 still belongs to cell 0', () => {
    // pipe at 9 closes cell 0; col=9 should still return 0
    expect(findCellIndexAtPos(line, 9)).toBe(0)
  })

  test('cursor on the opening pipe of cell 1 belongs to cell 0 (it IS the closing pipe of cell 0)', () => {
    // The same pipe at position 9 is both the close of cell 0 AND the open of cell 1.
    // findCellIndexAtPos walks ranges where [pipeStart, pipeEnd] — the overlapping pipe
    // at 9 is pipeEnd for cell 0 (so col=9 still returns 0 because the check is <=pipeEnd).
    expect(findCellIndexAtPos(line, 9)).toBe(0)
  })

  test('cursor one past the last pipe is null', () => {
    expect(findCellIndexAtPos(line, line.length)).toBeNull()
  })

  test('cursor at position 0 (first pipe) belongs to cell 0', () => {
    expect(findCellIndexAtPos(line, 0)).toBe(0)
  })
})

// ── 5. buildEmptyRow with 1 column ─────────────────────────────────────────

describe('buildEmptyRow single-column', () => {
  test('numbered row with 1 column', () => {
    expect(buildEmptyRow(1, 1)).toBe('| Cell 1 |')
  })

  test('empty scaffold row with 1 column', () => {
    // No starting number → empty-cell variant
    expect(buildEmptyRow(1)).toBe('|  |')
  })
})

// ── 6. nextCellTarget with mismatched column counts ─────────────────────────
//
// Some real-world tables have a row with fewer cells than the divider suggests.
// nextCellTarget uses the CURRENT ROW's cell count, so a short row still
// wraps to the next row at its own last cell.

describe('nextCellTarget with mismatched column counts', () => {
  // Row 2 has only 1 cell; divider says 2 columns.
  const lines = [
    '| H1 | H2 |',
    '| --- | --- |',
    '| short |',
    '| A | B |',
  ]
  const bounds = findTableBounds(lines, 0)!

  test('Tab from the single cell of the short row wraps to the next row', () => {
    const target = nextCellTarget(lines, 2, 0, bounds)
    expect(target).toEqual({ lineIdx: 3, cellIdx: 0, appendRow: false })
  })
})

// ── 7. Shift-Tab from second body row back to first body row ─────────────────
//
// This exercises prevCellTarget crossing a body-row boundary in the
// DOWN direction (lower row number).

describe('prevCellTarget across body rows', () => {
  const lines = [
    '| H1 | H2 | H3 |',
    '| --- | --- | --- |',
    '| A | B | C |',
    '| D | E | F |',
  ]
  const bounds = findTableBounds(lines, 0)!

  test('Shift-Tab from cell 0 of row 3 → cell 2 of row 2', () => {
    const target = prevCellTarget(lines, 3, 0, bounds)
    expect(target).toEqual({ lineIdx: 2, cellIdx: 2 })
  })

  test('Shift-Tab from cell 1 of row 2 → cell 0 of row 2', () => {
    const target = prevCellTarget(lines, 2, 1, bounds)
    expect(target).toEqual({ lineIdx: 2, cellIdx: 0 })
  })
})

// ── 8. findTableBounds: cursor on various rows of a multi-body table ─────────

describe('findTableBounds cursor position invariant', () => {
  const lines = [
    '| A | B |',
    '| --- | --- |',
    '| C | D |',
    '| E | F |',
    '| G | H |',
  ]
  const expected = {
    headerIdx: 0,
    dividerIdx: 1,
    bodyStartIdx: 2,
    bodyEndIdx: 4,
  }

  test('returns same bounds from every row within the table', () => {
    for (let i = 0; i <= 4; i++) {
      expect(findTableBounds(lines, i)).toEqual(expected)
    }
  })

  test('returns null for a row index past the end of the table', () => {
    expect(findTableBounds(lines, 5)).toBeNull()
  })

  test('returns null for a negative row index', () => {
    expect(findTableBounds(lines, -1)).toBeNull()
  })
})

// ── 9. Table surrounded by non-table content ─────────────────────────────────

describe('findTableBounds with surrounding non-table content', () => {
  const lines = [
    'intro paragraph',
    '',
    '| H1 | H2 |',
    '| --- | --- |',
    '| C1 | C2 |',
    '',
    'outro paragraph',
  ]

  test('correctly identifies table bounds when cursor is on header', () => {
    expect(findTableBounds(lines, 2)).toEqual({
      headerIdx: 2,
      dividerIdx: 3,
      bodyStartIdx: 4,
      bodyEndIdx: 4,
    })
  })

  test('returns null when cursor is on a blank line above the table', () => {
    expect(findTableBounds(lines, 1)).toBeNull()
  })

  test('returns null when cursor is on the outro paragraph', () => {
    expect(findTableBounds(lines, 6)).toBeNull()
  })
})
