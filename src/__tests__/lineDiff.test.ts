/**
 * lineDiff.test.ts
 *
 * Unit tests for src/utils/lineDiff.ts — pure functions, no mocks needed.
 */

import { splitLines, joinLines, diffByLine, composeMerged, DiffHunk } from '../utils/lineDiff'

// ── splitLines ────────────────────────────────────────────────────────────────

describe('splitLines', () => {
  test('empty string returns []', () => {
    expect(splitLines('')).toEqual([])
  })

  test('single line with no newline returns [line]', () => {
    expect(splitLines('a')).toEqual(['a'])
  })

  test('two lines separated by \\n', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
  })

  test('CRLF is treated the same as LF', () => {
    expect(splitLines('a\r\nb')).toEqual(['a', 'b'])
  })

  test('trailing newline produces empty string as last element', () => {
    expect(splitLines('a\n')).toEqual(['a', ''])
  })

  test('trailing CRLF produces empty string as last element', () => {
    expect(splitLines('a\r\n')).toEqual(['a', ''])
  })

  test('three lines', () => {
    expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  test('blank lines in the middle are preserved', () => {
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b'])
  })

  test('only a newline returns two empty strings', () => {
    expect(splitLines('\n')).toEqual(['', ''])
  })
})

// ── joinLines ─────────────────────────────────────────────────────────────────

describe('joinLines', () => {
  test('empty array returns empty string', () => {
    expect(joinLines([])).toBe('')
  })

  test('single element returns that element', () => {
    expect(joinLines(['a'])).toBe('a')
  })

  test('two elements joined with \\n (not \\r\\n)', () => {
    expect(joinLines(['a', 'b'])).toBe('a\nb')
  })

  test('three elements', () => {
    expect(joinLines(['a', 'b', 'c'])).toBe('a\nb\nc')
  })

  test('empty strings preserved as blank lines', () => {
    expect(joinLines(['a', '', 'b'])).toBe('a\n\nb')
  })

  test('trailing empty string becomes trailing newline', () => {
    expect(joinLines(['a', ''])).toBe('a\n')
  })
})

// ── diffByLine ────────────────────────────────────────────────────────────────

describe('diffByLine', () => {
  test('both empty → []', () => {
    expect(diffByLine('', '')).toEqual([])
  })

  test('identical single line → one equal hunk', () => {
    expect(diffByLine('same', 'same')).toEqual([
      { type: 'equal', lines: ['same'] },
    ])
  })

  test('identical multi-line content → single equal hunk with all lines', () => {
    const text = 'a\nb\nc'
    const hunks = diffByLine(text, text)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toEqual({ type: 'equal', lines: ['a', 'b', 'c'] })
  })

  test('pure remote insert (local empty, remote has lines) → one change hunk with empty localLines', () => {
    const hunks = diffByLine('', 'added line')
    expect(hunks).toHaveLength(1)
    const h = hunks[0]
    expect(h.type).toBe('change')
    if (h.type === 'change') {
      expect(h.localLines).toEqual([])
      expect(h.remoteLines).toEqual(['added line'])
    }
  })

  test('pure local delete (local has lines, remote empty) → one change hunk with empty remoteLines', () => {
    const hunks = diffByLine('removed line', '')
    expect(hunks).toHaveLength(1)
    const h = hunks[0]
    expect(h.type).toBe('change')
    if (h.type === 'change') {
      expect(h.localLines).toEqual(['removed line'])
      expect(h.remoteLines).toEqual([])
    }
  })

  test('shared prefix + change in middle + shared suffix → 3 hunks (equal, change, equal)', () => {
    const local  = 'header\nold middle\nfooter'
    const remote = 'header\nnew middle\nfooter'
    const hunks = diffByLine(local, remote)
    expect(hunks).toHaveLength(3)
    expect(hunks[0]).toEqual({ type: 'equal', lines: ['header'] })
    expect(hunks[1].type).toBe('change')
    if (hunks[1].type === 'change') {
      expect(hunks[1].localLines).toEqual(['old middle'])
      expect(hunks[1].remoteLines).toEqual(['new middle'])
    }
    expect(hunks[2]).toEqual({ type: 'equal', lines: ['footer'] })
  })

  test('adjacent del + ins ops coalesce into a single change hunk', () => {
    // Two consecutive lines both changed — must produce ONE change hunk, not two
    const local  = 'line1\nline2'
    const remote = 'lineA\nlineB'
    const hunks = diffByLine(local, remote)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].type).toBe('change')
    if (hunks[0].type === 'change') {
      expect(hunks[0].localLines).toEqual(['line1', 'line2'])
      expect(hunks[0].remoteLines).toEqual(['lineA', 'lineB'])
    }
  })

  test('change at the start followed by shared suffix', () => {
    const local  = 'old first\nshared'
    const remote = 'new first\nshared'
    const hunks = diffByLine(local, remote)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].type).toBe('change')
    expect(hunks[1]).toEqual({ type: 'equal', lines: ['shared'] })
  })

  test('shared prefix followed by change at the end', () => {
    const local  = 'shared\nold last'
    const remote = 'shared\nnew last'
    const hunks = diffByLine(local, remote)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toEqual({ type: 'equal', lines: ['shared'] })
    expect(hunks[1].type).toBe('change')
  })

  test('remote has extra lines appended → equal hunk + change hunk', () => {
    const local  = 'shared'
    const remote = 'shared\nextra line'
    const hunks = diffByLine(local, remote)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toEqual({ type: 'equal', lines: ['shared'] })
    if (hunks[1].type === 'change') {
      expect(hunks[1].localLines).toEqual([])
      expect(hunks[1].remoteLines).toEqual(['extra line'])
    }
  })

  test('blank lines are treated as content lines', () => {
    const local  = 'a\n\nb'
    const remote = 'a\nb'
    // The blank line was removed in remote
    const hunks = diffByLine(local, remote)
    // Expect at minimum one change hunk; the equal 'a' and 'b' may be merged
    const hasChange = hunks.some(h => h.type === 'change')
    expect(hasChange).toBe(true)
  })
})

// ── composeMerged ─────────────────────────────────────────────────────────────

describe('composeMerged', () => {
  test('only equal hunks → all lines joined verbatim', () => {
    const hunks: DiffHunk[] = [
      { type: 'equal', lines: ['a', 'b', 'c'] },
    ]
    expect(composeMerged(hunks, {})).toBe('a\nb\nc')
  })

  test('empty hunks array → empty string', () => {
    expect(composeMerged([], {})).toBe('')
  })

  test("choice 'local' keeps localLines, discards remoteLines", () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['local line'], remoteLines: ['remote line'] },
    ]
    expect(composeMerged(hunks, { 0: 'local' })).toBe('local line')
  })

  test("choice 'remote' keeps remoteLines, discards localLines", () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['local line'], remoteLines: ['remote line'] },
    ]
    expect(composeMerged(hunks, { 0: 'remote' })).toBe('remote line')
  })

  test("choice 'both' outputs localLines first, then remoteLines", () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['L1', 'L2'], remoteLines: ['R1'] },
    ]
    expect(composeMerged(hunks, { 0: 'both' })).toBe('L1\nL2\nR1')
  })

  test("choice 'skip' drops the change hunk entirely", () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['dropped'], remoteLines: ['also dropped'] },
    ]
    expect(composeMerged(hunks, { 0: 'skip' })).toBe('')
  })

  test('missing choice (undefined key) drops the change hunk', () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['L'], remoteLines: ['R'] },
    ]
    // No key provided at all
    expect(composeMerged(hunks, {})).toBe('')
  })

  test('equal hunk is always kept regardless of choices object', () => {
    const hunks: DiffHunk[] = [
      { type: 'equal', lines: ['kept'] },
    ]
    // Even an empty choices object must not drop the equal hunk
    expect(composeMerged(hunks, {})).toBe('kept')
  })

  test('choice index is hunk position in the ALL-hunks array (equal hunks occupy slots too)', () => {
    // hunks[0]=equal, hunks[1]=change, hunks[2]=equal
    // The change hunk is at index 1 in the full array
    const hunks: DiffHunk[] = [
      { type: 'equal', lines: ['header'] },
      { type: 'change', localLines: ['local'], remoteLines: ['remote'] },
      { type: 'equal', lines: ['footer'] },
    ]
    const result = composeMerged(hunks, { 1: 'local' })
    expect(result).toBe('header\nlocal\nfooter')
  })

  test('multiple change hunks each resolved independently', () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['L1'], remoteLines: ['R1'] },
      { type: 'equal', lines: ['mid'] },
      { type: 'change', localLines: ['L2'], remoteLines: ['R2'] },
    ]
    const result = composeMerged(hunks, { 0: 'local', 2: 'remote' })
    expect(result).toBe('L1\nmid\nR2')
  })

  test("round-trip: composeMerged(diffByLine(L, R), {changeHunkIdx: 'local'}) === L when there is a single change hunk", () => {
    const L = 'header\nlocal content\nfooter'
    const R = 'header\nremote content\nfooter'
    const hunks = diffByLine(L, R)

    // Find the index of the change hunk in the full hunks array
    const changeIdx = hunks.findIndex(h => h.type === 'change')
    expect(changeIdx).not.toBe(-1)

    const merged = composeMerged(hunks, { [changeIdx]: 'local' })
    expect(merged).toBe(L)
  })

  test("round-trip: composeMerged(diffByLine(L, R), {changeHunkIdx: 'remote'}) === R when there is a single change hunk", () => {
    const L = 'header\nlocal content\nfooter'
    const R = 'header\nremote content\nfooter'
    const hunks = diffByLine(L, R)

    const changeIdx = hunks.findIndex(h => h.type === 'change')
    const merged = composeMerged(hunks, { [changeIdx]: 'remote' })
    expect(merged).toBe(R)
  })

  test("round-trip with pure insert: choosing 'remote' reconstructs R", () => {
    const L = ''
    const R = 'inserted\nlines'
    const hunks = diffByLine(L, R)
    const changeIdx = hunks.findIndex(h => h.type === 'change')
    expect(composeMerged(hunks, { [changeIdx]: 'remote' })).toBe(R)
  })

  test("round-trip with pure delete: choosing 'local' reconstructs L", () => {
    const L = 'original\ncontent'
    const R = ''
    const hunks = diffByLine(L, R)
    const changeIdx = hunks.findIndex(h => h.type === 'change')
    expect(composeMerged(hunks, { [changeIdx]: 'local' })).toBe(L)
  })
})
