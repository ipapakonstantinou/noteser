// Mini Obsidian-Tasks DSL: lets users embed ```tasks code fences in notes
// that render as live task lists.
//
// Supported tokens (case-insensitive, position-insensitive, multi-line OK):
//   not done                                 → only incomplete tasks
//   done                                     → only completed tasks
//   done today                               → completed AND completedDate === today
//   path includes <substring...>             → folder-chain + filename contains substring
//   due before|after|on YYYY-MM-DD           → due-date comparison
//   due                                      → tasks with any due date
//   no due date                              → tasks without a due date
//   scheduled before|after|on YYYY-MM-DD     → scheduled-date comparison
//   scheduled                                → tasks with any scheduled date
//   no scheduled date                        → tasks without a scheduled date
//   priority is <level>                      → exact-priority filter
//   priority above|below <level>             → priority comparison (PRIORITY_WEIGHT)
//   group by folder|filename|tag|priority    → group results
//   sort by due|priority|created|status|title→ ordering within each group
//   explain                                  → render the parsed query above results
//
// Multiple group-by clauses combine in declaration order. Only one `sort by`
// applies — later occurrences overwrite earlier ones. Filters AND together.
// Unknown tokens are silently skipped.

import {
  extractTasks,
  todayISO,
  PRIORITY_WEIGHT,
  type Task,
  type TaskPriority,
  type TaskSourceNote,
} from './tasks'
import { extractTags } from './tags'
import type { Folder } from '@/types'

export type TaskFilter =
  | { kind: 'notDone' }
  | { kind: 'done' }
  | { kind: 'doneToday' }
  | { kind: 'pathIncludes'; substring: string }
  | { kind: 'dueBefore'; date: string }
  | { kind: 'dueAfter'; date: string }
  | { kind: 'dueOn'; date: string }
  | { kind: 'hasDue' }
  | { kind: 'noDue' }
  | { kind: 'scheduledBefore'; date: string }
  | { kind: 'scheduledAfter'; date: string }
  | { kind: 'scheduledOn'; date: string }
  | { kind: 'hasScheduled' }
  | { kind: 'noScheduled' }
  | { kind: 'priorityIs'; priority: TaskPriority }
  | { kind: 'priorityAbove'; priority: TaskPriority }
  | { kind: 'priorityBelow'; priority: TaskPriority }

export type GroupBy = 'folder' | 'filename' | 'tag' | 'priority'

export type SortKey = 'due' | 'priority' | 'created' | 'status' | 'title'

export interface TaskQuery {
  filters: TaskFilter[]
  groupBy: GroupBy[]
  sortBy?: SortKey
  explain: boolean
  source: string
}

export interface ExecutedTask extends Task {
  path: string         // "Folder/Subfolder/Note title"
  noteTitle: string
  folderPath: string   // "Folder/Subfolder" — empty for root-level notes
  noteCreatedAt: number  // milliseconds; used for `sort by created`
  tags: string[]       // distinct #tags extracted from the host note body
}

export interface TaskGroup {
  keys: string[]       // one entry per groupBy level
  tasks: ExecutedTask[]
}

// Keywords that mark the start of a new clause when scanning the tail of
// `path includes <substring...>`. Anything that begins a new top-level clause
// belongs here.
const CLAUSE_KEYWORDS = new Set([
  'not', 'done', 'path', 'group', 'explain',
  'due', 'no', 'scheduled', 'priority', 'sort',
])

const PRIORITY_LEVELS: ReadonlySet<TaskPriority> = new Set([
  'highest', 'high', 'normal', 'low', 'lowest',
])

function asPriority(token: string | undefined): TaskPriority | null {
  if (!token) return null
  const t = token.toLowerCase()
  return PRIORITY_LEVELS.has(t as TaskPriority) ? (t as TaskPriority) : null
}

// Lenient date check: we don't validate calendars, just shape. The executor
// compares as strings since metadata dates are stored as `YYYY-MM-DD`.
function isISODate(token: string | undefined): boolean {
  return !!token && /^\d{4}-\d{2}-\d{2}$/.test(token)
}

// Obsidian-Tasks allows quoting a `path includes` argument so multi-word or
// punctuation-heavy substrings read naturally, e.g. `path includes "Projects"`.
// The quotes are delimiters, not part of the substring — strip a single
// matching leading/trailing pair (`"…"` or `'…'`) before matching. Without
// this, the literal quote chars stay in the substring and the path never
// matches. This was the `done today` "0 results" bug: the real query carried
// `path includes "Projects"` and the quoted substring excluded every task.
function stripWrappingQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' || first === "'") && last === first) {
      return s.slice(1, -1)
    }
  }
  return s
}

export function parseTaskQuery(source: string): TaskQuery {
  const tokens = source.split(/\s+/).map(t => t.trim()).filter(Boolean)
  const out: TaskQuery = { filters: [], groupBy: [], explain: false, source }

  let i = 0
  const lower = (idx: number) => tokens[idx]?.toLowerCase()

  while (i < tokens.length) {
    const t = lower(i)

    if (t === 'not' && lower(i + 1) === 'done') {
      out.filters.push({ kind: 'notDone' })
      i += 2
    } else if (t === 'done' && lower(i + 1) === 'today') {
      out.filters.push({ kind: 'doneToday' })
      i += 2
    } else if (t === 'done') {
      out.filters.push({ kind: 'done' })
      i += 1
    } else if (t === 'path' && lower(i + 1) === 'includes') {
      const parts: string[] = []
      let j = i + 2
      while (j < tokens.length && !CLAUSE_KEYWORDS.has(lower(j) ?? '')) {
        parts.push(tokens[j])
        j++
      }
      const substring = stripWrappingQuotes(parts.join(' '))
      if (substring) out.filters.push({ kind: 'pathIncludes', substring })
      i = j
    } else if (t === 'due' && lower(i + 1) === 'before' && isISODate(tokens[i + 2])) {
      out.filters.push({ kind: 'dueBefore', date: tokens[i + 2] })
      i += 3
    } else if (t === 'due' && lower(i + 1) === 'after' && isISODate(tokens[i + 2])) {
      out.filters.push({ kind: 'dueAfter', date: tokens[i + 2] })
      i += 3
    } else if (t === 'due' && lower(i + 1) === 'on' && isISODate(tokens[i + 2])) {
      out.filters.push({ kind: 'dueOn', date: tokens[i + 2] })
      i += 3
    } else if (t === 'due') {
      out.filters.push({ kind: 'hasDue' })
      i += 1
    } else if (t === 'no' && lower(i + 1) === 'due' && lower(i + 2) === 'date') {
      out.filters.push({ kind: 'noDue' })
      i += 3
    } else if (t === 'no' && lower(i + 1) === 'scheduled' && lower(i + 2) === 'date') {
      out.filters.push({ kind: 'noScheduled' })
      i += 3
    } else if (t === 'scheduled' && lower(i + 1) === 'before' && isISODate(tokens[i + 2])) {
      out.filters.push({ kind: 'scheduledBefore', date: tokens[i + 2] })
      i += 3
    } else if (t === 'scheduled' && lower(i + 1) === 'after' && isISODate(tokens[i + 2])) {
      out.filters.push({ kind: 'scheduledAfter', date: tokens[i + 2] })
      i += 3
    } else if (t === 'scheduled' && lower(i + 1) === 'on' && isISODate(tokens[i + 2])) {
      out.filters.push({ kind: 'scheduledOn', date: tokens[i + 2] })
      i += 3
    } else if (t === 'scheduled') {
      out.filters.push({ kind: 'hasScheduled' })
      i += 1
    } else if (t === 'priority' && lower(i + 1) === 'is') {
      const p = asPriority(tokens[i + 2])
      if (p) out.filters.push({ kind: 'priorityIs', priority: p })
      i += p ? 3 : 2
    } else if (t === 'priority' && lower(i + 1) === 'above') {
      const p = asPriority(tokens[i + 2])
      if (p) out.filters.push({ kind: 'priorityAbove', priority: p })
      i += p ? 3 : 2
    } else if (t === 'priority' && lower(i + 1) === 'below') {
      const p = asPriority(tokens[i + 2])
      if (p) out.filters.push({ kind: 'priorityBelow', priority: p })
      i += p ? 3 : 2
    } else if (t === 'group' && lower(i + 1) === 'by') {
      const key = lower(i + 2)
      if (key === 'folder' || key === 'filename' || key === 'tag' || key === 'priority') {
        out.groupBy.push(key)
      }
      i += 3
    } else if (t === 'sort' && lower(i + 1) === 'by') {
      const key = lower(i + 2)
      if (
        key === 'due' || key === 'priority' || key === 'created' ||
        key === 'status' || key === 'title'
      ) {
        out.sortBy = key
      }
      i += 3
    } else if (t === 'explain') {
      out.explain = true
      i += 1
    } else {
      // Unrecognized — skip.
      i += 1
    }
  }

  return out
}

export interface ExecuteContext {
  notes: TaskSourceNote[]
  folders: Folder[]
  today?: string
  lenientDoneToday?: boolean
}

function isSameLocalDay(timestamp: number | undefined, isoDate: string): boolean {
  if (typeof timestamp !== 'number') return false
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return false
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}` === isoDate
}

function buildFolderPath(folderId: string | null, folderById: Map<string, Folder>): string {
  const segs: string[] = []
  let cur = folderId
  // Guard against cycles in pathological data — cap at a sane depth.
  let depth = 0
  while (cur && depth < 64) {
    const f = folderById.get(cur)
    if (!f) break
    segs.unshift(f.name)
    cur = f.parentId
    depth++
  }
  return segs.join('/')
}

export function executeTaskQuery(query: TaskQuery, ctx: ExecuteContext): ExecutedTask[] {
  const today = ctx.today ?? todayISO()
  const folderById = new Map<string, Folder>()
  for (const f of ctx.folders) {
    if (!f.isDeleted) folderById.set(f.id, f)
  }

  const all: ExecutedTask[] = []
  for (const note of ctx.notes) {
    if (note.isDeleted) continue
    const noteTasks = extractTasks([note])
    const meta = note as { folderId?: string | null; title?: string; createdAt?: number; updatedAt?: number; content?: string }
    const folderPath = buildFolderPath(meta.folderId ?? null, folderById)
    const title = meta.title || 'Untitled'
    const path = folderPath ? `${folderPath}/${title}` : title
    const noteCreatedAt = typeof meta.createdAt === 'number' ? meta.createdAt : 0
    const tags = extractTags(meta.content ?? '')
    for (const t of noteTasks) {
      const completedDate =
        ctx.lenientDoneToday && t.completed && !t.completedDate && isSameLocalDay(meta.updatedAt, today)
          ? today
          : t.completedDate
      all.push({ ...t, completedDate, path, noteTitle: title, folderPath, noteCreatedAt, tags })
    }
  }

  return all.filter(t => {
    for (const f of query.filters) {
      if (f.kind === 'notDone' && t.completed) return false
      if (f.kind === 'done' && !t.completed) return false
      if (f.kind === 'doneToday' && (!t.completed || t.completedDate !== today)) return false
      if (f.kind === 'pathIncludes' && !t.path.toLowerCase().includes(f.substring.toLowerCase())) {
        return false
      }
      // Date filters compare lexicographically; YYYY-MM-DD makes that
      // equivalent to a chronological compare.
      if (f.kind === 'dueBefore') {
        if (!t.dueDate || !(t.dueDate < f.date)) return false
      }
      if (f.kind === 'dueAfter') {
        if (!t.dueDate || !(t.dueDate > f.date)) return false
      }
      if (f.kind === 'dueOn') {
        if (t.dueDate !== f.date) return false
      }
      if (f.kind === 'hasDue' && !t.dueDate) return false
      if (f.kind === 'noDue' && t.dueDate) return false
      if (f.kind === 'scheduledBefore') {
        if (!t.scheduledDate || !(t.scheduledDate < f.date)) return false
      }
      if (f.kind === 'scheduledAfter') {
        if (!t.scheduledDate || !(t.scheduledDate > f.date)) return false
      }
      if (f.kind === 'scheduledOn') {
        if (t.scheduledDate !== f.date) return false
      }
      if (f.kind === 'hasScheduled' && !t.scheduledDate) return false
      if (f.kind === 'noScheduled' && t.scheduledDate) return false
      if (f.kind === 'priorityIs' && t.priority !== f.priority) return false
      if (f.kind === 'priorityAbove' && !(PRIORITY_WEIGHT[t.priority] > PRIORITY_WEIGHT[f.priority])) {
        return false
      }
      if (f.kind === 'priorityBelow' && !(PRIORITY_WEIGHT[t.priority] < PRIORITY_WEIGHT[f.priority])) {
        return false
      }
    }
    return true
  })
}

// Stable sort using insertion-order tie-breaks. Mutates in place.
function sortTasksInPlace(tasks: ExecutedTask[], sortBy: SortKey): void {
  const indexed = tasks.map((t, idx) => ({ t, idx }))
  indexed.sort((a, b) => {
    let cmp = 0
    if (sortBy === 'due') {
      const ad = a.t.dueDate
      const bd = b.t.dueDate
      if (ad === bd) cmp = 0
      else if (!ad) cmp = 1            // nulls last
      else if (!bd) cmp = -1
      else cmp = ad < bd ? -1 : 1
    } else if (sortBy === 'priority') {
      // Descending by weight: highest first.
      cmp = PRIORITY_WEIGHT[b.t.priority] - PRIORITY_WEIGHT[a.t.priority]
    } else if (sortBy === 'created') {
      // Descending by note createdAt; ties → original order (idx).
      cmp = b.t.noteCreatedAt - a.t.noteCreatedAt
    } else if (sortBy === 'status') {
      // Incomplete (false) first, completed (true) after.
      const av = a.t.completed ? 1 : 0
      const bv = b.t.completed ? 1 : 0
      cmp = av - bv
    } else if (sortBy === 'title') {
      cmp = a.t.noteTitle.localeCompare(b.t.noteTitle)
    }
    return cmp !== 0 ? cmp : a.idx - b.idx
  })
  for (let i = 0; i < indexed.length; i++) tasks[i] = indexed[i].t
}

// Bucket label for the "no tag" group. Kept distinct from any legal tag
// name (which never contain spaces) so it can't collide.
const NO_TAG_LABEL = '(no tag)'

// For `group by tag`, a task with multiple tags appears in EACH of its
// tag buckets. Tasks with no tags fall into the NO_TAG_LABEL bucket.
function expandGroupKeys(
  task: ExecutedTask,
  groupBy: GroupBy[]
): string[][] {
  // Recursive cartesian-product over groupBy axes.
  if (groupBy.length === 0) return [[]]
  const [head, ...rest] = groupBy
  const headValues: string[] = (() => {
    if (head === 'folder') return [task.folderPath || 'Root']
    if (head === 'filename') return [task.noteTitle]
    if (head === 'priority') return [task.priority]
    // tag
    return task.tags.length === 0 ? [NO_TAG_LABEL] : task.tags
  })()
  const tail = expandGroupKeys(task, rest)
  const out: string[][] = []
  for (const hv of headValues) {
    for (const tv of tail) out.push([hv, ...tv])
  }
  return out
}

export function groupTasks(
  tasks: ExecutedTask[],
  groupBy: GroupBy[],
  sortBy?: SortKey
): TaskGroup[] {
  if (groupBy.length === 0) {
    const single = tasks.slice()
    if (sortBy) sortTasksInPlace(single, sortBy)
    return [{ keys: [], tasks: single }]
  }

  const buckets = new Map<string, { keys: string[]; tasks: ExecutedTask[] }>()
  for (const t of tasks) {
    for (const keys of expandGroupKeys(t, groupBy)) {
      const id = JSON.stringify(keys)
      const existing = buckets.get(id)
      if (existing) existing.tasks.push(t)
      else buckets.set(id, { keys, tasks: [t] })
    }
  }

  const groups = Array.from(buckets.values()).sort((a, b) => {
    for (let i = 0; i < a.keys.length; i++) {
      // `priority` axis sorts by PRIORITY_WEIGHT (highest first) so groups
      // come out in a meaningful order. Everything else is alphabetical.
      if (groupBy[i] === 'priority') {
        const aw = PRIORITY_WEIGHT[a.keys[i] as TaskPriority] ?? -1
        const bw = PRIORITY_WEIGHT[b.keys[i] as TaskPriority] ?? -1
        if (aw !== bw) return bw - aw
      } else {
        const cmp = a.keys[i].localeCompare(b.keys[i])
        if (cmp !== 0) return cmp
      }
    }
    return 0
  })

  if (sortBy) {
    for (const g of groups) sortTasksInPlace(g.tasks, sortBy)
  }

  return groups
}

// Human-readable rendering of a query for the `explain` flag.
export function explainQuery(q: TaskQuery): string {
  const parts: string[] = []
  for (const f of q.filters) {
    if (f.kind === 'notDone') parts.push('not done')
    else if (f.kind === 'done') parts.push('done')
    else if (f.kind === 'doneToday') parts.push('done today')
    else if (f.kind === 'pathIncludes') parts.push(`path includes "${f.substring}"`)
    else if (f.kind === 'dueBefore') parts.push(`due before ${f.date}`)
    else if (f.kind === 'dueAfter') parts.push(`due after ${f.date}`)
    else if (f.kind === 'dueOn') parts.push(`due on ${f.date}`)
    else if (f.kind === 'hasDue') parts.push('due')
    else if (f.kind === 'noDue') parts.push('no due date')
    else if (f.kind === 'scheduledBefore') parts.push(`scheduled before ${f.date}`)
    else if (f.kind === 'scheduledAfter') parts.push(`scheduled after ${f.date}`)
    else if (f.kind === 'scheduledOn') parts.push(`scheduled on ${f.date}`)
    else if (f.kind === 'hasScheduled') parts.push('scheduled')
    else if (f.kind === 'noScheduled') parts.push('no scheduled date')
    else if (f.kind === 'priorityIs') parts.push(`priority is ${f.priority}`)
    else if (f.kind === 'priorityAbove') parts.push(`priority above ${f.priority}`)
    else if (f.kind === 'priorityBelow') parts.push(`priority below ${f.priority}`)
  }
  for (const g of q.groupBy) parts.push(`group by ${g}`)
  if (q.sortBy) parts.push(`sort by ${q.sortBy}`)
  return parts.join(' · ') || '(empty query)'
}
