/**
 * weeklyReview.ts
 *
 * Builds a "Weekly review" note body from the user's last 7 days of
 * notes. Pure helpers — easy to unit-test — kept off the noteStore so
 * the TemplatesModal can call them directly.
 *
 * The output groups:
 *   - Open tasks pulled from `- [ ] ...` lines (so the user has a
 *     single Sunday checklist to close out unfinished items)
 *   - Done tasks pulled from `- [x] ...` (a quick "what got done" recap)
 *   - The week's top tags (`#word`) so trends jump out
 *   - Links back to each note touched this week
 *
 * Reasoning notes:
 *   - We use updatedAt, not createdAt, so a note that was started
 *     earlier but worked on this week still surfaces.
 *   - Tasks are deduped by their normalised text — the same TODO copy-
 *     pasted into multiple notes only appears once.
 *   - Caps protect against pathological inputs (10000-task vaults
 *     would otherwise produce an unusable wall of bullets).
 */

import { extractTags } from './tags'

export interface WeeklyReviewNote {
  id: string
  title: string
  content: string
  updatedAt: number
  isDeleted?: boolean
}

export interface BuildWeeklyReviewOptions {
  weekStartsOnMonday?: boolean
}

const MAX_TASKS_PER_BUCKET = 100
const MAX_TAGS = 25

const taskKey = (text: string) => text.trim().toLowerCase()

const splitLines = (s: string) => s.split(/\r?\n/)

const parseOpenTask = (line: string): string | null => {
  const m = line.match(/^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/)
  return m ? m[1] : null
}

const parseDoneTask = (line: string): string | null => {
  // Match both `[x]` and `[X]`.
  const m = line.match(/^\s*[-*]\s+\[[xX]\]\s+(.+?)\s*$/)
  return m ? m[1] : null
}

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const startOfDay = (d: Date) => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/**
 * Returns the inclusive lower bound for "this week" given `now`.
 * Default behaviour: rolling 7-day window (now - 7d, 00:00).
 * If `weekStartsOnMonday` is true, snaps to the most recent Monday.
 */
export const weeklyWindowStart = (now: Date, weekStartsOnMonday = false): Date => {
  if (!weekStartsOnMonday) {
    const d = new Date(now)
    d.setDate(d.getDate() - 7)
    return startOfDay(d)
  }
  const d = startOfDay(now)
  // getDay(): 0=Sun, 1=Mon, ... 6=Sat. Want to land on Monday.
  const day = d.getDay()
  const back = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - back)
  return d
}

export interface WeeklyReviewResult {
  body: string
  // Surfaced for tests + callers that want to know if there's
  // anything to show. An empty week still produces a body (with a
  // "no activity" note) but `notesTouched` lets the caller decide
  // whether to skip the modal.
  notesTouched: number
  openTaskCount: number
  doneTaskCount: number
  tagCount: number
}

/**
 * Build a Weekly Review markdown body.
 *
 * @param notes  All notes from the store. Deleted notes are skipped.
 * @param now    Reference "now" — usually `new Date()`.
 */
export const buildWeeklyReview = (
  notes: WeeklyReviewNote[],
  now: Date,
  opts: BuildWeeklyReviewOptions = {},
): WeeklyReviewResult => {
  const from = weeklyWindowStart(now, opts.weekStartsOnMonday ?? false)
  const fromMs = from.getTime()

  const recent = notes
    .filter(n => !n.isDeleted && n.updatedAt >= fromMs)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const openTasksSeen = new Set<string>()
  const doneTasksSeen = new Set<string>()
  const openTasks: { text: string; from: string }[] = []
  const doneTasks: { text: string; from: string }[] = []
  const tagCounts = new Map<string, number>()

  for (const note of recent) {
    for (const line of splitLines(note.content)) {
      const open = parseOpenTask(line)
      if (open) {
        const key = taskKey(open)
        if (!openTasksSeen.has(key) && openTasks.length < MAX_TASKS_PER_BUCKET) {
          openTasksSeen.add(key)
          openTasks.push({ text: open, from: note.title || '(untitled)' })
        }
        continue
      }
      const done = parseDoneTask(line)
      if (done) {
        const key = taskKey(done)
        if (!doneTasksSeen.has(key) && doneTasks.length < MAX_TASKS_PER_BUCKET) {
          doneTasksSeen.add(key)
          doneTasks.push({ text: done, from: note.title || '(untitled)' })
        }
      }
    }
    for (const tag of extractTags(note.content)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  const sortedTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TAGS)

  const lines: string[] = []
  lines.push(`# Weekly Review — ${fmtDate(now)}`)
  lines.push('')
  lines.push(`_Window: ${fmtDate(from)} → ${fmtDate(now)} (${recent.length} note${recent.length === 1 ? '' : 's'} touched)_`)
  lines.push('')

  if (recent.length === 0) {
    lines.push('## No activity this week')
    lines.push('')
    lines.push('Nothing was edited in the past 7 days. Maybe time to capture a few thoughts?')
    lines.push('')
    return {
      body: lines.join('\n'),
      notesTouched: 0, openTaskCount: 0, doneTaskCount: 0, tagCount: 0,
    }
  }

  lines.push('## Open tasks to close out')
  lines.push('')
  if (openTasks.length === 0) {
    lines.push('_No open `- [ ]` tasks — inbox zero ✨_')
  } else {
    for (const t of openTasks) {
      lines.push(`- [ ] ${t.text}  _(from ${t.from})_`)
    }
  }
  lines.push('')

  lines.push('## Done this week')
  lines.push('')
  if (doneTasks.length === 0) {
    lines.push('_No completed `- [x]` tasks logged._')
  } else {
    for (const t of doneTasks) {
      lines.push(`- [x] ${t.text}  _(from ${t.from})_`)
    }
  }
  lines.push('')

  lines.push('## Top tags')
  lines.push('')
  if (sortedTags.length === 0) {
    lines.push('_No `#tags` used this week._')
  } else {
    lines.push(sortedTags.map(([tag, count]) => `\`#${tag}\` (${count})`).join(' · '))
  }
  lines.push('')

  lines.push('## Notes touched')
  lines.push('')
  for (const note of recent) {
    lines.push(`- [[${note.title || '(untitled)'}]]`)
  }
  lines.push('')

  lines.push('## Reflections')
  lines.push('')
  lines.push('_What went well? What to change next week?_')
  lines.push('')

  return {
    body: lines.join('\n'),
    notesTouched: recent.length,
    openTaskCount: openTasks.length,
    doneTaskCount: doneTasks.length,
    tagCount: sortedTags.length,
  }
}
