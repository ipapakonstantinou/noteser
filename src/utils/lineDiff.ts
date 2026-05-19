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

// ── Three-way merge ────────────────────────────────────────────────────────
//
// Given a common ancestor and two derived versions (`local`, `remote`), try to
// auto-merge them line-by-line. The classic algorithm: for each region that
// differs, if only ONE side changed relative to the ancestor we take that
// side's lines; if BOTH changed in the same region we report a conflict.
//
// Implementation note: we do it in two LCS passes (ancestor↔local, then
// ancestor↔remote), then walk the ancestor line by line, advancing a pointer
// into each side. Whenever both sides have an insertion (lines that don't
// appear in the ancestor) AT THE SAME ancestor position we have to compare
// them: identical inserts merge cleanly, differing inserts are an overlap
// conflict. The cost is O((|ancestor|+|local|+|remote|) * max(...)) for the
// two LCS computations — well within budget for note-sized inputs.
//
// We do NOT attempt to be "smart" about which lines logically pair up. If
// both sides edited the same ancestor line into different values, that's a
// conflict — even if the line content is similar.

export type ThreeWayMergeResult =
  | { ok: true; merged: string }
  | { ok: false; reason: 'conflicting-overlap' }

// Internal: pairwise LCS-based edit ops between ancestor `a` and side `b`.
// Returns per-position info on what happened to each ancestor line.
//
// For every ancestor line i (0..a.length-1) we record:
//   - `kept`:    true  → ancestor line i appears unchanged in b
//                false → ancestor line i was deleted by b
//   - `insertsBeforeI`: lines b inserted that come BEFORE the next surviving
//                       ancestor line. Index i = "inserts to emit right before
//                       ancestor line i". We use index a.length for tail
//                       inserts (after the last ancestor line).
interface SideEdits {
  kept: boolean[]              // length === a.length
  insertsBeforeI: string[][]   // length === a.length + 1
}

function computeSideEdits(a: string[], b: string[]): SideEdits {
  const n = a.length
  const m = b.length
  const dp: number[][] = []
  for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack: produce ops in source order. We emit ops as one of:
  //   { kind: 'eq', ai }    ancestor line ai survived
  //   { kind: 'del', ai }   ancestor line ai was deleted by b
  //   { kind: 'ins', bj }   b inserted a line not in ancestor (at this position)
  type Op =
    | { kind: 'eq'; ai: number }
    | { kind: 'del'; ai: number }
    | { kind: 'ins'; bj: number }
  const ops: Op[] = []
  let i = n, j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { ops.unshift({ kind: 'eq', ai: i - 1 }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.unshift({ kind: 'del', ai: i - 1 }); i-- }
    else { ops.unshift({ kind: 'ins', bj: j - 1 }); j-- }
  }
  while (i > 0) { ops.unshift({ kind: 'del', ai: i - 1 }); i-- }
  while (j > 0) { ops.unshift({ kind: 'ins', bj: j - 1 }); j-- }

  const kept = new Array<boolean>(n).fill(false)
  const insertsBeforeI: string[][] = []
  for (let k = 0; k <= n; k++) insertsBeforeI.push([])

  // Walk ops; pending inserts attach to the next surviving/deleted ancestor
  // position, or to position n (tail) if we reach the end first.
  let nextAncestorPos = 0  // ancestor line we'll process next (eq or del)
  let pendingInserts: string[] = []
  for (const op of ops) {
    if (op.kind === 'ins') {
      pendingInserts.push(b[op.bj])
      continue
    }
    // eq or del — flush inserts to "before this ancestor line"
    if (pendingInserts.length > 0) {
      insertsBeforeI[nextAncestorPos].push(...pendingInserts)
      pendingInserts = []
    }
    if (op.kind === 'eq') kept[op.ai] = true
    // op.ai must equal nextAncestorPos by construction; advance.
    nextAncestorPos = op.ai + 1
  }
  // Any leftover inserts are tail inserts.
  if (pendingInserts.length > 0) {
    insertsBeforeI[n].push(...pendingInserts)
  }

  return { kept, insertsBeforeI }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function threeWayMerge(
  ancestor: string,
  local: string,
  remote: string,
): ThreeWayMergeResult {
  // Fast paths.
  if (local === remote) return { ok: true, merged: local }
  if (local === ancestor) return { ok: true, merged: remote }
  if (remote === ancestor) return { ok: true, merged: local }

  const a = splitLines(ancestor)
  const l = splitLines(local)
  const r = splitLines(remote)

  const ll = computeSideEdits(a, l)
  const rr = computeSideEdits(a, r)

  const out: string[] = []
  for (let i = 0; i <= a.length; i++) {
    const li = ll.insertsBeforeI[i]
    const ri = rr.insertsBeforeI[i]

    // The "region" at this ancestor-line boundary spans the inserts BEFORE i
    // and the deletion/keep of line i itself. If both sides made changes that
    // touch this region, we must conflict; otherwise we take whichever side
    // (if any) made the change.
    const ancestorLineExists = i < a.length
    const keptL = ancestorLineExists ? ll.kept[i] : true
    const keptR = ancestorLineExists ? rr.kept[i] : true
    const localTouchedLine = ancestorLineExists && !keptL
    const remoteTouchedLine = ancestorLineExists && !keptR
    const localInsertedHere = li.length > 0
    const remoteInsertedHere = ri.length > 0

    const localChangedRegion = localInsertedHere || localTouchedLine
    const remoteChangedRegion = remoteInsertedHere || remoteTouchedLine

    if (localChangedRegion && remoteChangedRegion) {
      // Both touched this region. Two ways to still merge cleanly:
      //   (a) the changes are byte-identical (both deleted, OR both inserted
      //       the same lines with the same handling of the ancestor line)
      //   (b) one side's "change" matches the ancestor for the surviving line
      //       — impossible by construction here since localTouched/remote
      //       Touched means the line wasn't kept verbatim.
      const sameInserts = arraysEqual(li, ri)
      const sameKept = keptL === keptR
      if (sameInserts && sameKept) {
        // Emit inserts once.
        if (localInsertedHere) out.push(...li)
        if (ancestorLineExists && keptL) out.push(a[i])
        continue
      }
      return { ok: false, reason: 'conflicting-overlap' }
    }

    // At most one side touched this region. Emit its inserts (if any) and
    // then the ancestor line if at least one of the two sides kept it. Since
    // only one side may have changed the region, the other side's contribution
    // for both the inserts and the keep-bit is "match ancestor".
    if (localChangedRegion) {
      if (localInsertedHere) out.push(...li)
      // Local touched the ancestor line → respect its keep/delete decision.
      if (ancestorLineExists && keptL) out.push(a[i])
    } else if (remoteChangedRegion) {
      if (remoteInsertedHere) out.push(...ri)
      if (ancestorLineExists && keptR) out.push(a[i])
    } else {
      // Neither side changed this region — keep the ancestor line as-is.
      if (ancestorLineExists) out.push(a[i])
    }
  }

  return { ok: true, merged: joinLines(out) }
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
