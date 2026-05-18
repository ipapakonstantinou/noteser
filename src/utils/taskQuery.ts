// Mini Obsidian-Tasks DSL: lets users embed ```tasks code fences in notes
// that render as live task lists.
//
// Supported tokens (case-insensitive, position-insensitive, multi-line OK):
//   not done                          → only incomplete tasks
//   done                              → only completed tasks
//   done today                        → completed AND completedDate === today
//   path includes <substring...>      → folder-chain + filename contains substring
//   group by folder                   → group results by folder path
//   group by filename                 → group results by note title
//   explain                           → render the parsed query above results
//
// Out of scope for v1: due dates, priorities, recurring, scheduled, sorting,
// quoted substrings. Multiple group-by clauses combine in declaration order.

import { extractTasks, todayISO, type Task, type TaskSourceNote } from './tasks'
import type { Folder } from '@/types'

export type TaskFilter =
  | { kind: 'notDone' }
  | { kind: 'done' }
  | { kind: 'doneToday' }
  | { kind: 'pathIncludes'; substring: string }

export type GroupBy = 'folder' | 'filename'

export interface TaskQuery {
  filters: TaskFilter[]
  groupBy: GroupBy[]
  explain: boolean
  source: string
}

export interface ExecutedTask extends Task {
  path: string         // "Folder/Subfolder/Note title"
  noteTitle: string
  folderPath: string   // "Folder/Subfolder" — empty for root-level notes
}

export interface TaskGroup {
  keys: string[]       // one entry per groupBy level
  tasks: ExecutedTask[]
}

// Keywords that mark the start of a new clause when scanning the tail of
// `path includes <substring...>`.
const CLAUSE_KEYWORDS = new Set(['not', 'done', 'path', 'group', 'explain'])

export function parseTaskQuery(source: string): TaskQuery {
  const tokens = source.split(/\s+/).map(t => t.trim()).filter(Boolean)
  const out: TaskQuery = { filters: [], groupBy: [], explain: false, source }

  let i = 0
  while (i < tokens.length) {
    const lower = (idx: number) => tokens[idx]?.toLowerCase()
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
      if (parts.length) out.filters.push({ kind: 'pathIncludes', substring: parts.join(' ') })
      i = j
    } else if (t === 'group' && lower(i + 1) === 'by') {
      const key = lower(i + 2)
      if (key === 'folder' || key === 'filename') out.groupBy.push(key)
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
    const folderPath = buildFolderPath((note as { folderId?: string | null }).folderId ?? null, folderById)
    const title = (note as { title?: string }).title || 'Untitled'
    const path = folderPath ? `${folderPath}/${title}` : title
    for (const t of noteTasks) {
      all.push({ ...t, path, noteTitle: title, folderPath })
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
    }
    return true
  })
}

export function groupTasks(tasks: ExecutedTask[], groupBy: GroupBy[]): TaskGroup[] {
  if (groupBy.length === 0) return [{ keys: [], tasks }]

  const buckets = new Map<string, { keys: string[]; tasks: ExecutedTask[] }>()
  for (const t of tasks) {
    const keys = groupBy.map(g => {
      if (g === 'folder') return t.folderPath || 'Root'
      return t.noteTitle
    })
    const id = JSON.stringify(keys)
    const existing = buckets.get(id)
    if (existing) existing.tasks.push(t)
    else buckets.set(id, { keys, tasks: [t] })
  }

  return Array.from(buckets.values()).sort((a, b) => {
    for (let i = 0; i < a.keys.length; i++) {
      const cmp = a.keys[i].localeCompare(b.keys[i])
      if (cmp !== 0) return cmp
    }
    return 0
  })
}

// Human-readable rendering of a query for the `explain` flag.
export function explainQuery(q: TaskQuery): string {
  const parts: string[] = []
  for (const f of q.filters) {
    if (f.kind === 'notDone') parts.push('not done')
    else if (f.kind === 'done') parts.push('done')
    else if (f.kind === 'doneToday') parts.push('done today')
    else if (f.kind === 'pathIncludes') parts.push(`path includes "${f.substring}"`)
  }
  for (const g of q.groupBy) parts.push(`group by ${g}`)
  return parts.join(' · ') || '(empty query)'
}
