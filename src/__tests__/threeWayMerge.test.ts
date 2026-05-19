/**
 * threeWayMerge.test.ts
 *
 * Unit tests for the line-level 3-way merge in src/utils/lineDiff.ts.
 *
 * The merge is purely line-based:
 *   - Identical inputs trivially succeed.
 *   - When only ONE side changed a region (relative to the common ancestor)
 *     that side's lines are taken.
 *   - When BOTH sides changed a region we report ok:false so the caller can
 *     fall back to the manual merge editor.
 */

import { threeWayMerge } from '../utils/lineDiff'

function ok(r: ReturnType<typeof threeWayMerge>): string {
  if (!r.ok) throw new Error(`expected ok merge, got conflict: ${r.reason}`)
  return r.merged
}

describe('threeWayMerge — trivial cases', () => {
  test('identical ancestor / local / remote → unchanged', () => {
    const t = 'a\nb\nc'
    expect(ok(threeWayMerge(t, t, t))).toBe(t)
  })

  test('local matches ancestor → take remote', () => {
    const ancestor = 'a\nb\nc'
    const remote   = 'a\nB\nc'
    expect(ok(threeWayMerge(ancestor, ancestor, remote))).toBe(remote)
  })

  test('remote matches ancestor → take local', () => {
    const ancestor = 'a\nb\nc'
    const local    = 'a\nB\nc'
    expect(ok(threeWayMerge(ancestor, local, ancestor))).toBe(local)
  })

  test('empty ancestor + empty local + empty remote → empty', () => {
    expect(ok(threeWayMerge('', '', ''))).toBe('')
  })
})

describe('threeWayMerge — non-overlapping edits merge', () => {
  test('local edits line 1, remote edits line 3 → both kept', () => {
    const ancestor = 'one\ntwo\nthree'
    const local    = 'ONE\ntwo\nthree'
    const remote   = 'one\ntwo\nTHREE'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('ONE\ntwo\nTHREE')
  })

  test('local appends at end, remote prepends at top → both kept', () => {
    const ancestor = 'shared'
    const local    = 'shared\nlocal tail'
    const remote   = 'remote head\nshared'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('remote head\nshared\nlocal tail')
  })

  test('local deletes a line, remote untouched → line deleted', () => {
    const ancestor = 'a\nb\nc'
    const local    = 'a\nc'
    expect(ok(threeWayMerge(ancestor, local, ancestor))).toBe('a\nc')
  })

  test('remote deletes a line, local untouched → line deleted', () => {
    const ancestor = 'a\nb\nc'
    const remote   = 'a\nc'
    expect(ok(threeWayMerge(ancestor, ancestor, remote))).toBe('a\nc')
  })

  test('local inserts in the middle, remote untouched → insert kept', () => {
    const ancestor = 'a\nc'
    const local    = 'a\nb\nc'
    expect(ok(threeWayMerge(ancestor, local, ancestor))).toBe('a\nb\nc')
  })

  test('both sides make the SAME edit → no conflict, take it once', () => {
    const ancestor = 'a\nb\nc'
    const local    = 'a\nB\nc'
    const remote   = 'a\nB\nc'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('a\nB\nc')
  })

  test('local edits early line, remote appends new line at end', () => {
    const ancestor = 'one\ntwo\nthree'
    const local    = 'ONE\ntwo\nthree'
    const remote   = 'one\ntwo\nthree\nfour'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('ONE\ntwo\nthree\nfour')
  })

  test('local and remote insert different lines at non-adjacent spots', () => {
    const ancestor = 'a\nb\nc\nd\ne'
    const local    = 'a\nLOCAL\nb\nc\nd\ne'
    const remote   = 'a\nb\nc\nREMOTE\nd\ne'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('a\nLOCAL\nb\nc\nREMOTE\nd\ne')
  })

  test('one side untouched, other refactors heavily → take the refactor', () => {
    const ancestor = 'l1\nl2\nl3'
    const remote   = 'X\nY\nZ\nW'
    expect(ok(threeWayMerge(ancestor, ancestor, remote))).toBe(remote)
  })
})

describe('threeWayMerge — overlapping edits conflict', () => {
  test('both sides change the same line differently → conflict', () => {
    const ancestor = 'a\nb\nc'
    const local    = 'a\nLOCAL\nc'
    const remote   = 'a\nREMOTE\nc'
    const r = threeWayMerge(ancestor, local, remote)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('conflicting-overlap')
  })

  test('local deletes a line that remote modifies → conflict', () => {
    const ancestor = 'a\nb\nc'
    const local    = 'a\nc'
    const remote   = 'a\nB-MOD\nc'
    expect(threeWayMerge(ancestor, local, remote).ok).toBe(false)
  })

  test('local appends X, remote appends Y at end → conflict', () => {
    const ancestor = 'shared'
    const local    = 'shared\nX'
    const remote   = 'shared\nY'
    expect(threeWayMerge(ancestor, local, remote).ok).toBe(false)
  })

  test('both sides insert at the same position with different content → conflict', () => {
    const ancestor = 'a\nb'
    const local    = 'a\nLOCAL\nb'
    const remote   = 'a\nREMOTE\nb'
    expect(threeWayMerge(ancestor, local, remote).ok).toBe(false)
  })
})

describe('threeWayMerge — whitespace + blank-line edge cases', () => {
  test('trailing newline added by one side only → preserved', () => {
    const ancestor = 'a\nb'
    const local    = 'a\nb\n'
    const r = threeWayMerge(ancestor, local, ancestor)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.merged).toBe('a\nb\n')
  })

  test('blank line inserted in the middle by one side', () => {
    const ancestor = 'a\nb'
    const local    = 'a\n\nb'
    expect(ok(threeWayMerge(ancestor, local, ancestor))).toBe('a\n\nb')
  })

  test('CRLF input: line-level merge normalizes to LF when going through the slow path', () => {
    // Both sides changed different lines so the slow path runs. splitLines
    // accepts CRLF; joinLines emits LF.
    const ancestor = 'a\r\nb\r\nc'
    const local    = 'A\r\nb\r\nc'
    const remote   = 'a\r\nb\r\nC'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe('A\nb\nC')
  })

  test('CRLF fast-path (one side matches ancestor): returned verbatim', () => {
    // remote === ancestor → fast path returns local string as-is, preserving CRLF.
    const ancestor = 'a\r\nb'
    const local    = 'a\r\nB'
    const r = threeWayMerge(ancestor, local, ancestor)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.merged).toBe(local)
  })
})

describe('threeWayMerge — realistic note edits', () => {
  test('user appends a #tag locally, Obsidian fixes a typo remotely', () => {
    const ancestor =
      'Meeting Notes\n\nDiscuss launch timing.\nReview budget.\n'
    const local =
      'Meeting Notes\n\nDiscuss launch timing.\nReview budget.\n#followup\n'
    const remote =
      'Meeting Notes\n\nDiscuss launch timing.\nReview the budget.\n'
    const expected =
      'Meeting Notes\n\nDiscuss launch timing.\nReview the budget.\n#followup\n'
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe(expected)
  })

  test('two sides editing entirely separate paragraphs', () => {
    const ancestor = [
      '# Title',
      '',
      'Paragraph one.',
      '',
      'Paragraph two.',
      '',
      'Paragraph three.',
    ].join('\n')
    const local = [
      '# Title',
      '',
      'Paragraph one (edited locally).',
      '',
      'Paragraph two.',
      '',
      'Paragraph three.',
    ].join('\n')
    const remote = [
      '# Title',
      '',
      'Paragraph one.',
      '',
      'Paragraph two.',
      '',
      'Paragraph three (edited remotely).',
    ].join('\n')
    const expected = [
      '# Title',
      '',
      'Paragraph one (edited locally).',
      '',
      'Paragraph two.',
      '',
      'Paragraph three (edited remotely).',
    ].join('\n')
    expect(ok(threeWayMerge(ancestor, local, remote))).toBe(expected)
  })
})
