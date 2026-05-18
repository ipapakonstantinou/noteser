// Aggregate `- [ ]` / `- [x]` checkboxes across all notes — Obsidian-style
// Tasks-plugin minimum viable subset.
//
// Recognized syntax (per line):
//   - [ ] thing to do
//   - [x] thing I did
//   - [x] thing I did ✅ 2026-05-18      ← strict "done today"
//
// Indentation before the dash is allowed (nested list items count). Bullet
// character must be `-` (matching the rest of the app's markdown conventions).

const TASK_LINE_REGEX = /^(\s*-\s+\[)( |x|X)(\]\s+)(.*)$/
const COMPLETED_DATE_REGEX = /\s*✅\s*(\d{4}-\d{2}-\d{2})\s*$/

export interface Task {
  noteId: string
  lineNumber: number   // 0-based, matches CodeMirror line numbering minus one
  text: string         // task body with the `✅ date` suffix stripped
  completed: boolean
  completedDate: string | null  // ISO YYYY-MM-DD or null
}

export interface TaskSourceNote {
  id: string
  content?: string
  isDeleted?: boolean
}

export function extractTasks(notes: TaskSourceNote[]): Task[] {
  const out: Task[] = []
  for (const note of notes) {
    if (note.isDeleted) continue
    if (!note.content) continue
    const lines = note.content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(TASK_LINE_REGEX)
      if (!m) continue
      const completed = m[2].toLowerCase() === 'x'
      let text = m[4]
      let completedDate: string | null = null
      const dateMatch = text.match(COMPLETED_DATE_REGEX)
      if (dateMatch) {
        completedDate = dateMatch[1]
        text = text.slice(0, dateMatch.index).trimEnd()
      }
      out.push({
        noteId: note.id,
        lineNumber: i,
        text,
        completed,
        completedDate,
      })
    }
  }
  return out
}

// YYYY-MM-DD in the local timezone — matches what a human would write today.
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Flip `[ ]` ↔ `[x]` on the given line. When checking, append ` ✅ today`.
// When unchecking, strip any trailing `✅ YYYY-MM-DD`. Returns the full new
// content. If the line doesn't match the task regex the content is returned
// unchanged.
export function toggleTaskLine(content: string, lineNumber: number, now: Date = new Date()): string {
  const lines = content.split(/\r?\n/)
  if (lineNumber < 0 || lineNumber >= lines.length) return content
  const line = lines[lineNumber]
  const m = line.match(TASK_LINE_REGEX)
  if (!m) return content

  const [, prefix, mark, mid, rest] = m
  const wasCompleted = mark.toLowerCase() === 'x'
  if (wasCompleted) {
    // Uncheck → strip trailing ✅ date if present.
    const stripped = rest.replace(COMPLETED_DATE_REGEX, '').trimEnd()
    lines[lineNumber] = `${prefix} ${mid}${stripped}`
  } else {
    // Check → stamp today's date if there isn't one already.
    const hasDate = COMPLETED_DATE_REGEX.test(rest)
    const body = hasDate ? rest : `${rest.trimEnd()} ✅ ${todayISO(now)}`
    lines[lineNumber] = `${prefix}x${mid}${body}`
  }
  return lines.join('\n')
}
