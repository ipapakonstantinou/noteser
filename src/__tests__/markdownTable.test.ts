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

describe('buildTable', () => {
  test('produces a 2×2 table by default', () => {
    const t = buildTable()
    expect(t.text).toBe(
      '| Header 1 | Header 2 |\n' +
      '| --- | --- |\n' +
      '| Cell 1 | Cell 2 |\n' +
      '| Cell 3 | Cell 4 |',
    )
  })

  test('selection range covers "Header 1" for immediate overtype', () => {
    const t = buildTable()
    expect(t.text.slice(t.selectionFrom, t.selectionTo)).toBe('Header 1')
  })

  test('supports custom row/col counts', () => {
    const t = buildTable(1, 3)
    expect(t.text).toBe(
      '| Header 1 | Header 2 | Header 3 |\n' +
      '| --- | --- | --- |\n' +
      '| Cell 1 | Cell 2 | Cell 3 |',
    )
  })

  test('divider row scales with column count', () => {
    const t = buildTable(2, 4)
    expect(t.text.split('\n')[1]).toBe('| --- | --- | --- | --- |')
  })

  test('returns empty insertion when rows or cols < 1', () => {
    expect(buildTable(0, 2)).toEqual({ text: '', selectionFrom: 0, selectionTo: 0 })
    expect(buildTable(2, 0)).toEqual({ text: '', selectionFrom: 0, selectionTo: 0 })
  })

  test('cell numbering is sequential left-to-right, top-to-bottom', () => {
    const t = buildTable(2, 3)
    expect(t.text).toContain('| Cell 1 | Cell 2 | Cell 3 |')
    expect(t.text).toContain('| Cell 4 | Cell 5 | Cell 6 |')
  })
})

describe('isTableRow', () => {
  test('matches lines with at least one pipe', () => {
    expect(isTableRow('| Header 1 | Header 2 |')).toBe(true)
    expect(isTableRow('a | b')).toBe(true)
  })

  test('rejects blank lines and lines with no pipe', () => {
    expect(isTableRow('')).toBe(false)
    expect(isTableRow('   ')).toBe(false)
    expect(isTableRow('plain text')).toBe(false)
  })
})

describe('isDividerRow', () => {
  test('matches canonical GFM divider', () => {
    expect(isDividerRow('| --- | --- |')).toBe(true)
    expect(isDividerRow('| --- | --- | --- |')).toBe(true)
  })

  test('matches divider with alignment colons', () => {
    expect(isDividerRow('|:---|---:|:---:|')).toBe(true)
    expect(isDividerRow('| :--- | ---: | :---: |')).toBe(true)
  })

  test('rejects header / body rows', () => {
    expect(isDividerRow('| Header 1 | Header 2 |')).toBe(false)
    expect(isDividerRow('| Cell 1 | Cell 2 |')).toBe(false)
    expect(isDividerRow('| --- | abc |')).toBe(false)
  })
})

describe('findTableBounds', () => {
  const sample = [
    'intro paragraph',
    '',
    '| Header 1 | Header 2 |',
    '| --- | --- |',
    '| Cell 1 | Cell 2 |',
    '| Cell 3 | Cell 4 |',
    '',
    'after',
  ]

  test('locates bounds from the header row', () => {
    expect(findTableBounds(sample, 2)).toEqual({
      headerIdx: 2,
      dividerIdx: 3,
      bodyStartIdx: 4,
      bodyEndIdx: 5,
    })
  })

  test('locates bounds from a body row', () => {
    expect(findTableBounds(sample, 5)).toEqual({
      headerIdx: 2,
      dividerIdx: 3,
      bodyStartIdx: 4,
      bodyEndIdx: 5,
    })
  })

  test('locates bounds from the divider row', () => {
    expect(findTableBounds(sample, 3)).toEqual({
      headerIdx: 2,
      dividerIdx: 3,
      bodyStartIdx: 4,
      bodyEndIdx: 5,
    })
  })

  test('returns null when the cursor is outside the table', () => {
    expect(findTableBounds(sample, 0)).toBeNull()
    expect(findTableBounds(sample, 6)).toBeNull()
    expect(findTableBounds(sample, 7)).toBeNull()
  })

  test('returns null when the row block has no divider', () => {
    const noDivider = ['| a | b |', '| c | d |']
    expect(findTableBounds(noDivider, 0)).toBeNull()
  })

  test('reports body equal to divider for header-only tables', () => {
    const empty = ['| Header 1 | Header 2 |', '| --- | --- |']
    expect(findTableBounds(empty, 0)).toEqual({
      headerIdx: 0,
      dividerIdx: 1,
      bodyStartIdx: 2,
      bodyEndIdx: 1,
    })
  })
})

describe('findCellRanges', () => {
  test('splits a 2-column row into 2 cells with content bounds', () => {
    const line = '| Cell 1 | Cell 2 |'
    const ranges = findCellRanges(line)
    expect(ranges).toHaveLength(2)
    expect(line.slice(ranges[0].contentStart, ranges[0].contentEnd)).toBe('Cell 1')
    expect(line.slice(ranges[1].contentStart, ranges[1].contentEnd)).toBe('Cell 2')
  })

  test('content bounds collapse to insert position for empty cells', () => {
    const line = '|   |   |'
    const ranges = findCellRanges(line)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].contentStart).toBe(ranges[0].contentEnd)
    expect(ranges[1].contentStart).toBe(ranges[1].contentEnd)
    // Caret lands one column after the opening pipe + leading space.
    expect(ranges[0].contentStart).toBe(2)
  })

  test('returns [] for a line with no pipes', () => {
    expect(findCellRanges('no pipes here')).toEqual([])
  })
})

describe('findCellIndexAtPos', () => {
  const line = '| Cell 1 | Cell 2 |'

  test('returns 0 when the cursor sits inside the first cell', () => {
    expect(findCellIndexAtPos(line, 3)).toBe(0)
  })

  test('returns 1 when the cursor sits inside the second cell', () => {
    expect(findCellIndexAtPos(line, 12)).toBe(1)
  })

  test('returns null when the column is outside any cell', () => {
    expect(findCellIndexAtPos(line, line.length)).toBeNull()
    expect(findCellIndexAtPos('no pipes', 0)).toBeNull()
  })
})

describe('nextCellTarget', () => {
  const lines = [
    '| Header 1 | Header 2 |',
    '| --- | --- |',
    '| Cell 1 | Cell 2 |',
    '| Cell 3 | Cell 4 |',
  ]
  const bounds = findTableBounds(lines, 0)!

  test('moves to the next cell on the same row', () => {
    expect(nextCellTarget(lines, 0, 0, bounds)).toEqual({
      lineIdx: 0,
      cellIdx: 1,
      appendRow: false,
    })
  })

  test('wraps from end of header to first body cell, skipping divider', () => {
    expect(nextCellTarget(lines, 0, 1, bounds)).toEqual({
      lineIdx: 2,
      cellIdx: 0,
      appendRow: false,
    })
  })

  test('wraps from end of a body row to the next body row', () => {
    expect(nextCellTarget(lines, 2, 1, bounds)).toEqual({
      lineIdx: 3,
      cellIdx: 0,
      appendRow: false,
    })
  })

  test('signals append when past the last cell of the last body row', () => {
    expect(nextCellTarget(lines, 3, 1, bounds)).toEqual({
      lineIdx: 4,
      cellIdx: 0,
      appendRow: true,
    })
  })
})

describe('prevCellTarget', () => {
  const lines = [
    '| Header 1 | Header 2 |',
    '| --- | --- |',
    '| Cell 1 | Cell 2 |',
    '| Cell 3 | Cell 4 |',
  ]
  const bounds = findTableBounds(lines, 0)!

  test('moves to the previous cell on the same row', () => {
    expect(prevCellTarget(lines, 2, 1, bounds)).toEqual({
      lineIdx: 2,
      cellIdx: 0,
    })
  })

  test('wraps from first body cell to last header cell, skipping divider', () => {
    expect(prevCellTarget(lines, 2, 0, bounds)).toEqual({
      lineIdx: 0,
      cellIdx: 1,
    })
  })

  test('returns null at the first cell of the header row', () => {
    expect(prevCellTarget(lines, 0, 0, bounds)).toBeNull()
  })

  test('wraps from second body row to first body row last cell', () => {
    expect(prevCellTarget(lines, 3, 0, bounds)).toEqual({
      lineIdx: 2,
      cellIdx: 1,
    })
  })
})

describe('buildEmptyRow', () => {
  test('builds a numbered row when startingCellNumber is provided', () => {
    expect(buildEmptyRow(2, 5)).toBe('| Cell 5 | Cell 6 |')
    expect(buildEmptyRow(3, 1)).toBe('| Cell 1 | Cell 2 | Cell 3 |')
  })

  test('builds an empty-scaffold row when no number is provided', () => {
    expect(buildEmptyRow(2)).toBe('|  |  |')
    expect(buildEmptyRow(3)).toBe('|  |  |  |')
  })

  test('returns empty string when cols < 1', () => {
    expect(buildEmptyRow(0)).toBe('')
  })
})
