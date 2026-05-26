// Pure line-transform helpers backing the Obsidian-style list / todo
// keyboard commands wired up in CodeMirrorEditor.tsx.
//
// Every function here operates on a SINGLE line of text and preserves the
// line's leading indentation (spaces / tabs) so nested list items keep their
// nesting. None of them touch CodeMirror — the editor command layer maps a
// selection to the affected line range, runs the transform per line, and
// dispatches one change. Keeping the string logic pure makes it unit-testable
// without a DOM.
//
// Recognised line shapes (after the leading indent):
//   plain         "text"
//   bullet        "- text"      (also * or +)
//   ordered       "1. text"     (any digits, then a dot)
//   task          "- [ ] text"  / "- [x] text"  (bullet or ordered carrier)
//
// The task carrier can itself be a bullet OR an ordered marker because
// remark-gfm renders "1. [ ] foo" as a checkbox too; the UI checkbox regex in
// utils/tasks.ts (UI_TASK_LINE_REGEX) accepts both, so we stay consistent.

const INDENT_RE = /^(\s*)/

// A line's leading whitespace.
export function leadingIndent(line: string): string {
  return INDENT_RE.exec(line)?.[1] ?? ''
}

// Strip indent + any list marker (bullet, ordered, or task) down to the bare
// content. Returns { indent, body } so callers can re-wrap. A plain line
// yields its own text (minus indent) as the body.
export function splitListLine(line: string): {
  indent: string
  kind: 'plain' | 'bullet' | 'ordered' | 'task'
  /** the checkbox char for tasks: ' ' | 'x' | 'X'; otherwise '' */
  check: string
  /** the carrier marker for a task, e.g. "- " or "1. " */
  carrier: string
  body: string
} {
  const indent = leadingIndent(line)
  const rest = line.slice(indent.length)

  // Task: "<bullet|ordered> [ ] body"
  const task = rest.match(/^([-*+]|\d+\.)\s+\[([ xX])\]\s?(.*)$/)
  if (task) {
    return {
      indent,
      kind: 'task',
      check: task[2],
      carrier: `${task[1]} `,
      body: task[3],
    }
  }

  // Ordered: "1. body"
  const ordered = rest.match(/^(\d+)\.\s+(.*)$/)
  if (ordered) {
    return { indent, kind: 'ordered', check: '', carrier: `${ordered[1]}. `, body: ordered[2] }
  }

  // Bullet: "- body"
  const bullet = rest.match(/^([-*+])\s+(.*)$/)
  if (bullet) {
    return { indent, kind: 'bullet', check: '', carrier: `${bullet[1]} `, body: bullet[2] }
  }

  return { indent, kind: 'plain', check: '', carrier: '', body: rest }
}

// ── Toggle DONE (Mod+L, Obsidian "Toggle checkbox status") ────────────────
// On a task line: flip [ ] <-> [x]. On a plain line or a bullet/ordered list
// line: turn it INTO an unchecked task. This is Obsidian's documented Cmd/Ctrl
// +L behaviour ("turns a plain line / bullet into a checkbox, and toggles a
// task line done/undone").
//
// Note: the editor command path routes EXISTING task lines through
// toggleTaskLineText (utils/tasks.ts) so the ✅-date stamp + recurrence
// behaviour is preserved. This helper only owns the plain/bullet/ordered ->
// task conversion and the simple [ ]<->[x] flip used in unit tests.
export function toggleDone(line: string): string {
  const p = splitListLine(line)
  if (p.kind === 'task') {
    const next = p.check === ' ' ? 'x' : ' '
    // Trim trailing space on an empty body so "- [ ] " <-> "- [x]" stays tidy.
    const tail = p.body === '' ? '' : ` ${p.body}`
    return `${p.indent}${p.carrier}[${next}]${tail}`
  }
  // plain / bullet / ordered -> unchecked task, keeping the existing carrier
  // when there is one (so "1. foo" becomes "1. [ ] foo", "- foo" -> "- [ ] foo").
  const carrier = p.carrier || '- '
  return `${p.indent}${carrier}[ ] ${p.body}`
}

// ── Toggle TODO (`- [ ]`) ─────────────────────────────────────────────────
// task -> plain (strip the marker), anything else -> unchecked task.
export function toggleTodo(line: string): string {
  const p = splitListLine(line)
  if (p.kind === 'task') {
    return `${p.indent}${p.body}`
  }
  const carrier = p.kind === 'ordered' ? p.carrier : '- '
  return `${p.indent}${carrier}[ ] ${p.body}`
}

// ── Toggle NUMBERED list (`1.`) ───────────────────────────────────────────
// ordered -> plain. Anything else (plain / bullet / task) -> ordered "1.".
// The actual sequence number is fixed up afterwards by renumberOrderedRuns.
export function toggleNumbered(line: string): string {
  const p = splitListLine(line)
  if (p.kind === 'ordered') {
    return `${p.indent}${p.body}`
  }
  // bullet/task/plain -> "1. body". For a task we keep the checkbox so a numbered
  // task list stays a task list ("1. [ ] foo").
  if (p.kind === 'task') {
    return `${p.indent}1. [${p.check}] ${p.body}`
  }
  return `${p.indent}1. ${p.body}`
}

// ── Toggle BULLET list (`-`) ──────────────────────────────────────────────
// bullet -> plain. Anything else -> "- ". Kept for completeness / parity with
// Obsidian's "Toggle bullet list".
export function toggleBullet(line: string): string {
  const p = splitListLine(line)
  if (p.kind === 'bullet') {
    return `${p.indent}${p.body}`
  }
  if (p.kind === 'task') {
    return `${p.indent}- [${p.check}] ${p.body}`
  }
  return `${p.indent}- ${p.body}`
}

// ── CYCLE numbered <-> task ───────────────────────────────────────────────
// Jon's explicit ask: switch a line between "1." and a task list.
//   ordered  -> task   ("1. foo"      -> "- [ ] foo")
//   task     -> ordered("- [ ] foo"   -> "1. foo")
//   bullet   -> ordered("- foo"       -> "1. foo")
//   plain    -> ordered("foo"         -> "1. foo")
// Numbers are fixed up by renumberOrderedRuns after the change.
export function cycleNumberedTask(line: string): string {
  const p = splitListLine(line)
  if (p.kind === 'ordered') {
    return `${p.indent}- [ ] ${p.body}`
  }
  if (p.kind === 'task') {
    return `${p.indent}1. ${p.body}`
  }
  // bullet or plain -> ordered
  return `${p.indent}1. ${p.body}`
}

// ── Renumber ordered-list runs ────────────────────────────────────────────
// Walk the whole document text and rewrite the leading number of every
// ordered-list item so each contiguous run at a given indent restarts at 1 and
// counts 1,2,3… A "run" breaks on a non-list line or an indent change at the
// same level. Nested levels keep independent counters (a deeper indent does
// not reset its parent's counter, and returning to a shallower indent
// continues that level's previous count only if the run was not interrupted).
//
// We track a counter per indent width. Any blank line or non-ordered line at a
// given width resets that width's counter (and deeper widths). This matches
// Obsidian's behaviour after a move/insert/delete: the visible numbers always
// read 1,2,3 within each block.
export function renumberOrderedRuns(text: string): string {
  const lines = text.split('\n')
  // counter keyed by indent width (number of leading whitespace chars,
  // tabs counted as one each — good enough since we only compare equality).
  const counters = new Map<number, number>()

  const resetDeeperThan = (width: number) => {
    for (const key of counters.keys()) {
      if (key > width) counters.delete(key)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const indent = leadingIndent(line)
    const width = indent.length
    const rest = line.slice(width)
    const ordered = rest.match(/^(\d+)\.(\s+)(.*)$/)

    if (!ordered) {
      // Non-ordered line. A blank line or any other content breaks every run
      // at this width and deeper (a shallower run is untouched so a parent
      // list survives nested sub-content).
      if (rest.trim() === '') {
        // Blank line: break all runs (a blank line ends a list in markdown).
        counters.clear()
      } else {
        counters.delete(width)
        resetDeeperThan(width)
      }
      continue
    }

    const next = (counters.get(width) ?? 0) + 1
    counters.set(width, next)
    // A new ordered item at this width breaks any deeper nested run.
    resetDeeperThan(width)
    lines[i] = `${indent}${next}.${ordered[2]}${ordered[3]}`
  }

  return lines.join('\n')
}
