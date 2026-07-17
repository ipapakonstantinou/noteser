import { formatDate } from '../utils/dateFormat'

describe('formatDate', () => {
  // Tuesday, May 19, 2026 — pick a non-ambiguous date with single-digit M/D
  // wouldn't apply, so also exercise a single-digit one separately.
  const date = new Date(2026, 4, 19) // month is 0-based

  test('YYYY / YY / MM / M / DD / D', () => {
    expect(formatDate(date, 'YYYY-MM-DD')).toBe('2026-05-19')
    expect(formatDate(date, 'YY')).toBe('26')
    expect(formatDate(date, 'M/D/YY')).toBe('5/19/26')
  })

  test('MMMM / MMM (month names)', () => {
    expect(formatDate(date, 'MMMM D, YYYY')).toBe('May 19, 2026')
    expect(formatDate(date, 'MMM D')).toBe('May 19')
    // January / December edge tokens
    expect(formatDate(new Date(2026, 0, 1), 'MMMM')).toBe('January')
    expect(formatDate(new Date(2026, 11, 31), 'MMMM')).toBe('December')
  })

  test('dddd / ddd (weekday names)', () => {
    expect(formatDate(date, 'dddd')).toBe('Tuesday') // 2026-05-19
    expect(formatDate(date, 'ddd')).toBe('Tue')
  })

  test('passes literal characters through', () => {
    expect(formatDate(date, 'YYYY/MM/DD (dddd)')).toBe('2026/05/19 (Tuesday)')
    expect(formatDate(date, 'no tokens here')).toBe('no tokens here')
  })

  test('longest-token-first match resolves M vs MM vs MMM vs MMMM correctly', () => {
    expect(formatDate(date, 'MMMM-MMM-MM-M')).toBe('May-May-05-5')
  })

  test('pads single-digit month and day', () => {
    const jan3 = new Date(2026, 0, 3)
    expect(formatDate(jan3, 'YYYY-MM-DD')).toBe('2026-01-03')
    expect(formatDate(jan3, 'M/D')).toBe('1/3')
  })
})

describe('literal escaping', () => {
  // The Settings help text has always advertised `YYYY-[W]WW` → 2026-W23, but the
  // formatter had no bracket support, so the W inside the brackets was read as the
  // week number and the promised format could not actually be typed.
  test('[...] passes through verbatim so a literal W is expressible', () => {
    expect(formatDate(new Date(2026, 6, 20), 'YYYY-[W]WW')).toBe('2026-W30')
    expect(formatDate(new Date(2026, 0, 5), 'YYYY-[W]WW')).toBe('2026-W02')
  })

  test('brackets do not swallow tokens outside them', () => {
    expect(formatDate(new Date(2026, 6, 17), '[week] WW [of] YYYY')).toBe('week 29 of 2026')
  })

  test('an empty bracket pair emits nothing', () => {
    expect(formatDate(new Date(2026, 6, 17), 'YYYY[]MM')).toBe('202607')
  })

  test('unbracketed formats keep working', () => {
    expect(formatDate(new Date(2026, 6, 17), 'YYYY-MM-DD')).toBe('2026-07-17')
    expect(formatDate(new Date(2026, 6, 17), 'YYYY-WW')).toBe('2026-29')
  })
})
