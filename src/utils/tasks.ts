// Aggregate `- [ ]` / `- [x]` checkboxes across all notes — Obsidian
// Tasks-plugin emoji metadata subset.
//
// Recognized syntax (per line):
//   - [ ] thing to do
//   - [x] thing I did
//   - [x] thing I did ✅ 2026-05-18              done date
//   - [ ] thing with 📅 2026-05-20                due date
//   - [ ] thing with ⏳ 2026-05-19                scheduled date
//   - [ ] thing with 🛫 2026-05-18                start date
//   - [ ] thing with ⏫ priority (highest)
//   - [ ] thing with 🔼 priority (high)
//   - [ ] thing with 🔽 priority (low)
//   - [ ] thing with ⏬ priority (lowest)
//
// Indentation before the dash is allowed (nested list items count).
// Bullet character must be `-` here; the rendered-preview path also
// accepts `*`, `+`, and numbered via UI_TASK_LINE_REGEX.

const TASK_LINE_REGEX = /^(\s*-\s+\[)( |x|X)(\]\s+)(.*)$/

// Each metadata regex matches anywhere in the task body. We capture the
// emoji-marker form so we can strip it cleanly when extracting the display
// text. `g` flag so we can iterate matches if a body has weird duplicates
// (use the first hit per kind).
const COMPLETED_DATE_REGEX = /\s*✅\s*(\d{4}-\d{2}-\d{2})\s*/g
const DUE_DATE_REGEX       = /\s*📅\s*(\d{4}-\d{2}-\d{2})\s*/g
const SCHEDULED_DATE_REGEX = /\s*⏳\s*(\d{4}-\d{2}-\d{2})\s*/g
const START_DATE_REGEX     = /\s*🛫\s*(\d{4}-\d{2}-\d{2})\s*/g
// Priority markers don't carry a date; we just detect the emoji.
const PRIORITY_REGEX       = /\s*(⏫|🔼|🔽|⏬)\s*/g

export type TaskPriority = 'highest' | 'high' | 'normal' | 'low' | 'lowest'

// Numeric weight for sort-by-priority. Higher = more urgent.
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  highest: 4,
  high: 3,
  normal: 2,
  low: 1,
  lowest: 0,
}

function priorityFromEmoji(emoji: string): TaskPriority {
  switch (emoji) {
    case '⏫': return 'highest'
    case '🔼': return 'high'
    case '🔽': return 'low'
    case '⏬': return 'lowest'
    default:   return 'normal'
  }
}

export interface Task {
  noteId: string
  lineNumber: number   // 0-based, matches CodeMirror line numbering minus one
  text: string         // task body with every metadata marker stripped
  completed: boolean
  completedDate: string | null  // ISO YYYY-MM-DD or null
  dueDate: string | null
  scheduledDate: string | null
  startDate: string | null
  priority: TaskPriority
}

// Extracts (and strips) every supported metadata marker from a body line.
// Returns the cleaned body + the parsed values. Multiple markers of the
// same kind are tolerated — we take the FIRST occurrence and drop the
// rest along with their surrounding whitespace.
export function parseTaskMetadata(body: string): {
  text: string
  completedDate: string | null
  dueDate: string | null
  scheduledDate: string | null
  startDate: string | null
  priority: TaskPriority
} {
  let text = body
  const firstMatch = (re: RegExp): string | null => {
    re.lastIndex = 0
    const m = re.exec(text)
    return m ? m[1] : null
  }
  const completedDate = firstMatch(COMPLETED_DATE_REGEX)
  const dueDate       = firstMatch(DUE_DATE_REGEX)
  const scheduledDate = firstMatch(SCHEDULED_DATE_REGEX)
  const startDate     = firstMatch(START_DATE_REGEX)
  const priorityEmoji = firstMatch(PRIORITY_REGEX)
  const priority = priorityEmoji ? priorityFromEmoji(priorityEmoji) : 'normal'

  // Now strip ALL occurrences of every marker so the display text is clean.
  // Order matters less than we'd think — each regex captures its own
  // surrounding whitespace, so successive replaces don't double-up.
  text = text
    .replace(COMPLETED_DATE_REGEX, ' ')
    .replace(DUE_DATE_REGEX, ' ')
    .replace(SCHEDULED_DATE_REGEX, ' ')
    .replace(START_DATE_REGEX, ' ')
    .replace(PRIORITY_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { text, completedDate, dueDate, scheduledDate, startDate, priority }
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
      const parsed = parseTaskMetadata(m[4])
      out.push({
        noteId: note.id,
        lineNumber: i,
        text: parsed.text,
        completed,
        completedDate: parsed.completedDate,
        dueDate: parsed.dueDate,
        scheduledDate: parsed.scheduledDate,
        startDate: parsed.startDate,
        priority: parsed.priority,
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
  const toggled = toggleTaskLineText(lines[lineNumber], now)
  if (toggled == null) return content
  lines[lineNumber] = toggled
  return lines.join('\n')
}

// Like `toggleTaskLine` but operates on a single line and accepts any list
// bullet (`-`, `*`, `+`, or numbered). The rendered-preview's checkbox handler
// uses this since remark-gfm renders task list items for all of those.
// Returns the toggled line, or null if the line isn't a task.
const UI_TASK_LINE_REGEX = /^(\s*(?:[-*+]|\d+\.)\s+\[)( |x|X)(\]\s+)(.*)$/

export function toggleTaskLineText(lineText: string, now: Date = new Date()): string | null {
  const m = lineText.match(UI_TASK_LINE_REGEX)
  if (!m) return null
  const [, prefix, mark, mid, rest] = m
  const wasCompleted = mark.toLowerCase() === 'x'
  if (wasCompleted) {
    // Strip the ✅ done date but keep due / scheduled / start / priority
    // intact — the user might un-check by accident, and we shouldn't
    // lose the rest of the metadata.
    COMPLETED_DATE_REGEX.lastIndex = 0
    const stripped = rest.replace(COMPLETED_DATE_REGEX, ' ').replace(/\s+/g, ' ').trimEnd()
    return `${prefix} ${mid}${stripped}`
  }
  COMPLETED_DATE_REGEX.lastIndex = 0
  const hasDate = COMPLETED_DATE_REGEX.test(rest)
  const body = hasDate ? rest : `${rest.trimEnd()} ✅ ${todayISO(now)}`
  return `${prefix}x${mid}${body}`
}

// Strip the list marker + checkbox from a task line so it becomes plain
// text. Preserves any leading indentation. Returns the stripped line, or
// null if the line isn't a task. E.g.
//   "  - [x] foo ✅ 2026-05-18"  →  "  foo ✅ 2026-05-18"
//   "regular text"               →  null
export function removeTaskPrefixFromLine(lineText: string): string | null {
  const m = lineText.match(UI_TASK_LINE_REGEX)
  if (!m) return null
  const [, prefix, , , rest] = m
  const indent = /^(\s*)/.exec(prefix)?.[1] ?? ''
  return `${indent}${rest}`
}
