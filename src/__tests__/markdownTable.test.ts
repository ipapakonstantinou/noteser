import { buildTable } from '../utils/markdownTable'

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
