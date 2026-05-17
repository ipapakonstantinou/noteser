// Line-level diff via Longest Common Subsequence.
//
// O(NM) time + space — fine for typical note-sized inputs (a few hundred
// lines). For huge files Myers diff would be faster, but the algorithmic
// upgrade isn't worth the extra code for our use case.

export type DiffHunk =
  | { type: 'equal'; lines: string[] }
  | { type: 'change'; localLines: string[]; remoteLines: string[] }

export function splitLines(text: string): string[] {
  // Preserve a trailing empty "line" only if the input ended without a
  // newline AND was non-empty — but since splitting on /\r?\n/ already
  // gives us that, we don't need extra handling.
  if (text === '') return []
  return text.split(/\r?\n/)
}

export function joinLines(lines: string[]): string {
  return lines.join('\n')
}

// Returns hunks describing how `local` differs from `remote`, line by line.
// `change` hunks are MAXIMAL — adjacent minus/plus ops are coalesced into
// one hunk so the user picks per region, not per line.
export function diffByLine(local: string, remote: string): DiffHunk[] {
  const a = splitLines(local)
  const b = splitLines(remote)
  const n = a.length
  const m = b.length

  // LCS length table.
  const dp: number[][] = []
  for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack to recover ops in source order.
  type Op = { kind: 'eq' | 'del' | 'ins'; line: string }
  const ops: Op[] = []
  let i = n, j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { ops.unshift({ kind: 'eq', line: a[i - 1] }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.unshift({ kind: 'del', line: a[i - 1] }); i-- }
    else { ops.unshift({ kind: 'ins', line: b[j - 1] }); j-- }
  }
  while (i > 0) { ops.unshift({ kind: 'del', line: a[i - 1] }); i-- }
  while (j > 0) { ops.unshift({ kind: 'ins', line: b[j - 1] }); j-- }

  // Coalesce runs into hunks.
  const hunks: DiffHunk[] = []
  let idx = 0
  while (idx < ops.length) {
    if (ops[idx].kind === 'eq') {
      const lines: string[] = []
      while (idx < ops.length && ops[idx].kind === 'eq') {
        lines.push(ops[idx].line)
        idx++
      }
      hunks.push({ type: 'equal', lines })
    } else {
      const localLines: string[] = []
      const remoteLines: string[] = []
      while (idx < ops.length && ops[idx].kind !== 'eq') {
        if (ops[idx].kind === 'del') localLines.push(ops[idx].line)
        else remoteLines.push(ops[idx].line)
        idx++
      }
      hunks.push({ type: 'change', localLines, remoteLines })
    }
  }
  return hunks
}

// Build the merged document from hunks given the user's choice per change-hunk.
//   - 'local' / 'remote' → keep one side
//   - 'both'             → keep both, local first then remote
//   - 'skip'             → drop the hunk entirely
//
// `choicesByHunkIndex` is indexed by the position of each `change` hunk among
// ALL hunks (so equal hunks have indices too). Equal hunks are always kept.
export function composeMerged(
  hunks: DiffHunk[],
  choicesByHunkIndex: Record<number, 'local' | 'remote' | 'both' | 'skip'>,
): string {
  const out: string[] = []
  hunks.forEach((h, i) => {
    if (h.type === 'equal') {
      out.push(...h.lines)
      return
    }
    const choice = choicesByHunkIndex[i]
    if (choice === 'local')  out.push(...h.localLines)
    else if (choice === 'remote') out.push(...h.remoteLines)
    else if (choice === 'both')   out.push(...h.localLines, ...h.remoteLines)
    // 'skip' or undefined → drop.
  })
  return joinLines(out)
}
