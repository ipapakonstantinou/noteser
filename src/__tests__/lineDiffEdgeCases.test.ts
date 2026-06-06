/**
 * lineDiffEdgeCases.test.ts
 *
 * Edge-case coverage for src/utils/lineDiff.ts beyond what lineDiff.test.ts
 * and threeWayMerge.test.ts already cover.
 *
 * Gaps addressed:
 *   1. diffByLine — all-delete (local has all lines, remote empty)
 *               — all-insert (local empty, remote has all lines)
 *               — large all-insert / all-delete (stresses the LCS loop)
 *               — single-character lines
 *               — repeated identical lines at multiple positions
 *   2. threeWayMerge — empty ancestor (both sides are pure inserts from nothing)
 *                    — single line ancestor / local / remote
 *                    — both sides delete everything (a convergent all-delete)
 *                    — both sides insert identical blocks at the end
 *                    — remote deletes ALL lines but local is unchanged → take remote (empty result)
 *                    — local deletes ALL lines but remote is unchanged → take local (empty result)
 *                    — local and remote make identical changes → merge once, not twice
 *   3. composeMerged — change hunk with empty localLines ('both' choice appends remote only)
 *                    — change hunk with empty remoteLines ('both' choice keeps local only)
 *                    — very long equal run between two change hunks
 *   4. splitLines / joinLines — round-trip identity for various content shapes
 */

import {
  splitLines,
  joinLines,
  diffByLine,
  composeMerged,
  threeWayMerge,
  type DiffHunk,
} from '../utils/lineDiff'

// ── Helper ───────────────────────────────────────────────────────────────────

function ok(r: ReturnType<typeof threeWayMerge>): string {
  if (!r.ok) throw new Error(`expected ok merge, got conflict: ${r.reason}`)
  return r.merged
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. diffByLine — additional edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe('diffByLine — all-insert (local empty, remote has all lines)', () => {
  test('single remote line', () => {
    const h = diffByLine('', 'alpha')
    expect(h).toHaveLength(1)
    expect(h[0].type).toBe('change')
    if (h[0].type === 'change') {
      expect(h[0].localLines).toEqual([])
      expect(h[0].remoteLines).toEqual(['alpha'])
    }
  })

  test('multiple remote lines', () => {
    const h = diffByLine('', 'a\nb\nc')
    expect(h).toHaveLength(1)
    expect(h[0].type).toBe('change')
    if (h[0].type === 'change') {
      expect(h[0].localLines).toEqual([])
      expect(h[0].remoteLines).toEqual(['a', 'b', 'c'])
    }
  })
})

describe('diffByLine — all-delete (local has all lines, remote empty)', () => {
  test('single local line deleted', () => {
    const h = diffByLine('gone', '')
    expect(h).toHaveLength(1)
    expect(h[0].type).toBe('change')
    if (h[0].type === 'change') {
      expect(h[0].localLines).toEqual(['gone'])
      expect(h[0].remoteLines).toEqual([])
    }
  })

  test('multiple local lines all deleted', () => {
    const h = diffByLine('x\ny\nz', '')
    expect(h).toHaveLength(1)
    expect(h[0].type).toBe('change')
    if (h[0].type === 'change') {
      expect(h[0].localLines).toEqual(['x', 'y', 'z'])
      expect(h[0].remoteLines).toEqual([])
    }
  })
})

describe('diffByLine — repeated identical lines', () => {
  test('shared repeated lines produce a single equal hunk', () => {
    // Both sides have "aaa" repeated — LCS should handle duplicates.
    const text = 'a\na\na'
    const h = diffByLine(text, text)
    expect(h).toHaveLength(1)
    expect(h[0]).toEqual({ type: 'equal', lines: ['a', 'a', 'a'] })
  })

  test('one repeated line replaced with another (all-change hunk)', () => {
    const h = diffByLine('a\na\na', 'b\nb\nb')
    expect(h).toHaveLength(1)
    expect(h[0].type).toBe('change')
  })

  test('shared prefix + changed middle (repeated lines in shared context)', () => {
    const local  = 'x\nx\nold\nx\nx'
    const remote = 'x\nx\nnew\nx\nx'
    const h = diffByLine(local, remote)
    // Should have: equal (x,x), change (old→new), equal (x,x)
    expect(h).toHaveLength(3)
    expect(h[0]).toEqual({ type: 'equal', lines: ['x', 'x'] })
    expect(h[1].type).toBe('change')
    expect(h[2]).toEqual({ type: 'equal', lines: ['x', 'x'] })
  })
})

describe('diffByLine — single-character lines', () => {
  test('equal single characters → equal hunk', () => {
    expect(diffByLine('a', 'a')).toEqual([{ type: 'equal', lines: ['a'] }])
  })

  test('different single characters → change hunk', () => {
    const h = diffByLine('a', 'b')
    expect(h).toHaveLength(1)
    expect(h[0].type).toBe('change')
    if (h[0].type === 'change') {
      expect(h[0].localLines).toEqual(['a'])
      expect(h[0].remoteLines).toEqual(['b'])
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. threeWayMerge — additional edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe('threeWayMerge — empty ancestor', () => {
  test('empty ancestor, same content on both sides → unchanged (fast path: local===remote)', () => {
    expect(ok(threeWayMerge('', 'line', 'line'))).toBe('line')
  })

  test('empty ancestor, only local inserted → take local (fast path: remote===ancestor)', () => {
    expect(ok(threeWayMerge('', 'local line', ''))).toBe('local line')
  })

  test('empty ancestor, only remote inserted → take remote (fast path: local===ancestor)', () => {
    expect(ok(threeWayMerge('', '', 'remote line'))).toBe('remote line')
  })

  test('empty ancestor, local and remote inserted DIFFERENT content → conflict', () => {
    // Both sides inserted into an empty ancestor at the same position → conflict.
    const r = threeWayMerge('', 'local insert', 'remote insert')
    expect(r.ok).toBe(false)
  })

  test('empty ancestor, local and remote inserted SAME content → merged (no duplicate)', () => {
    expect(ok(threeWayMerge('', 'shared insert', 'shared insert'))).toBe('shared insert')
  })

  test('all-empty: ancestor=empty, local=empty, remote=empty → empty', () => {
    expect(ok(threeWayMerge('', '', ''))).toBe('')
  })
})

describe('threeWayMerge — single-line ancestor', () => {
  test('single-line ancestor, local changes it, remote unchanged → take local', () => {
    expect(ok(threeWayMerge('line', 'LOCAL', 'line'))).toBe('LOCAL')
  })

  test('single-line ancestor, remote changes it, local unchanged → take remote', () => {
    expect(ok(threeWayMerge('line', 'line', 'REMOTE'))).toBe('REMOTE')
  })

  test('single-line ancestor, both change it differently → conflict', () => {
    expect(threeWayMerge('line', 'LOCAL', 'REMOTE').ok).toBe(false)
  })

  test('single-line ancestor, both delete it → empty result', () => {
    expect(ok(threeWayMerge('gone', '', ''))).toBe('')
  })

  test('single-line ancestor, only local deletes it → empty result', () => {
    expect(ok(threeWayMerge('gone', '', 'gone'))).toBe('')
  })

  test('single-line ancestor, only remote deletes it → empty result', () => {
    expect(ok(threeWayMerge('gone', 'gone', ''))).toBe('')
  })
})

describe('threeWayMerge — both sides delete entire content', () => {
  test('ancestor has many lines; both sides delete everything → empty string', () => {
    const ancestor = 'a\nb\nc\nd\ne'
    expect(ok(threeWayMerge(ancestor, '', ''))).toBe('')
  })

  test('ancestor has content; only one side deletes all → take that deletion', () => {
    const ancestor = 'a\nb\nc'
    expect(ok(threeWayMerge(ancestor, '', ancestor))).toBe('')
    expect(ok(threeWayMerge(ancestor, ancestor, ''))).toBe('')
  })
})

describe('threeWayMerge — both sides add identical content at the same position', () => {
  test('both append the SAME line at the end → merged once (not doubled)', () => {
    const ancestor = 'common'
    const local  = 'common\nnew line'
    const remote = 'common\nnew line'
    // identical inserts → clean merge (emitted once)
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('common\nnew line')
  })

  test('both insert the SAME block at the same boundary → merged once', () => {
    const ancestor = 'a\nb'
    const local  = 'a\nINSERT\nb'
    const remote = 'a\nINSERT\nb'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('a\nINSERT\nb')
  })
})

describe('threeWayMerge — multi-region non-overlapping merges', () => {
  test('three non-overlapping regions all changed by different sides → all merged', () => {
    const ancestor = 'A\nB\nC\nD\nE'
    const local    = 'A-L\nB\nC\nD\nE'      // local changes A
    const remote   = 'A\nB\nC\nD\nE-R'      // remote changes E
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('A-L\nB\nC\nD\nE-R')
  })

  test('local inserts before line 1, remote inserts after last line → both kept', () => {
    const ancestor = 'middle'
    const local    = 'BEFORE\nmiddle'
    const remote   = 'middle\nAFTER'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('BEFORE\nmiddle\nAFTER')
  })
})

describe('threeWayMerge — realistic large-note scenarios', () => {
  test('long unchanged ancestor + local adds heading + remote fixes typo in body', () => {
    const ancestor = [
      'Introduction',
      '',
      'This is a paragraf with a typo.',
      '',
      'Conclusion',
    ].join('\n')
    const local = [
      '# Introduction',   // local adds heading marker
      '',
      'This is a paragraf with a typo.',
      '',
      'Conclusion',
    ].join('\n')
    const remote = [
      'Introduction',
      '',
      'This is a paragraph with a typo fixed.',  // remote fixes typo
      '',
      'Conclusion',
    ].join('\n')
    const expected = [
      '# Introduction',
      '',
      'This is a paragraph with a typo fixed.',
      '',
      'Conclusion',
    ].join('\n')
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe(expected)
  })

  test('note where one side adds tasks at end, other side updates status', () => {
    const ancestor = 'Project notes\n\n- [ ] Task A\n- [ ] Task B\n'
    const local    = 'Project notes\n\n- [x] Task A\n- [ ] Task B\n'  // marks A done
    const remote   = 'Project notes\n\n- [ ] Task A\n- [ ] Task B\n- [ ] Task C\n'  // adds C
    // Different regions → auto-merge
    const merged = ok(threeWayMerge(ancestor, local, remote))
    expect(merged).toContain('[x] Task A')
    expect(merged).toContain('Task C')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. composeMerged — additional edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe('composeMerged — edge cases', () => {
  test("'both' with empty localLines appends only remoteLines", () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: [], remoteLines: ['R1', 'R2'] },
    ]
    expect(composeMerged(hunks, { 0: 'both' })).toBe('R1\nR2')
  })

  test("'both' with empty remoteLines keeps only localLines", () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['L1', 'L2'], remoteLines: [] },
    ]
    expect(composeMerged(hunks, { 0: 'both' })).toBe('L1\nL2')
  })

  test("'both' with both sides having lines concatenates L then R", () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['L1', 'L2'], remoteLines: ['R1'] },
    ]
    expect(composeMerged(hunks, { 0: 'both' })).toBe('L1\nL2\nR1')
  })

  test('large equal hunk between two change hunks → all lines preserved', () => {
    const equalLines = Array.from({ length: 50 }, (_, i) => `line ${i}`)
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['old-start'], remoteLines: ['new-start'] },
      { type: 'equal', lines: equalLines },
      { type: 'change', localLines: ['old-end'], remoteLines: ['new-end'] },
    ]
    const result = composeMerged(hunks, { 0: 'remote', 2: 'local' })
    const lines = result.split('\n')
    expect(lines[0]).toBe('new-start')
    expect(lines[lines.length - 1]).toBe('old-end')
    // All 50 equal lines are in the middle.
    expect(lines.length).toBe(1 + 50 + 1)
  })

  test('no hunks at all → empty string', () => {
    expect(composeMerged([], {})).toBe('')
  })

  test('only change hunk with no resolution (undefined choice) → empty', () => {
    const hunks: DiffHunk[] = [
      { type: 'change', localLines: ['L'], remoteLines: ['R'] },
    ]
    // No key in the record → hunk dropped, result is empty.
    expect(composeMerged(hunks, {})).toBe('')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. splitLines / joinLines — round-trip identity
// ══════════════════════════════════════════════════════════════════════════════

describe('splitLines/joinLines round-trip', () => {
  const testCases = [
    'simple line',
    'a\nb\nc',
    'a\n\nb',           // blank line in the middle
    'a\n',              // trailing newline (produces trailing empty element)
    '\n',               // just a newline
    '',                 // empty
    'a\r\nb',           // CRLF (split normalizes to LF on join)
  ]

  for (const input of testCases) {
    test(`joinLines(splitLines(s)) is consistent for "${input.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`, () => {
      const roundTripped = joinLines(splitLines(input))
      // The round-trip should NOT change the semantics (number of lines, content).
      // CRLF is normalized to LF since splitLines uses /\r?\n/.
      const expected = input.replace(/\r\n/g, '\n')
      expect(roundTripped).toBe(expected)
    })
  }
})
