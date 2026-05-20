// Minimal "Bases" query DSL — Obsidian Bases plugin parity for v1.
//
// Syntax (one directive per line, case-insensitive keywords):
//
//   from <folder>              limit to notes under this folder (and subs)
//   where tag <name>           note's #tags must include <name>
//   where folder <path>        folder match (alias for `from`)
//   where property <key>=<v>   frontmatter equality on the named key
//   columns title, tags, ...   which fields appear in the rendered table
//   sort <field> [asc|desc]    sort by a column
//   limit <N>                  cap the number of rows returned
//
// Recognised column names: title, folder, path, tags, modified, created,
// plus any frontmatter key in the matching notes (looked up at run time).
// Unknown columns render as the literal frontmatter value or an empty cell.

import type { Note, Folder } from '@/types'
import { extractTags } from './tags'
import { parseFrontmatter, type FrontmatterField } from './frontmatter'

export interface BasesQuery {
  from: string | null
  whereTags: string[]
  whereFolders: string[]
  whereProps: Array<{ key: string; value: string }>
  columns: string[]
  sortKey: string | null
  sortDir: 'asc' | 'desc'
  limit: number | null
}

export interface BasesRow {
  noteId: string
  title: string
  folderPath: string
  cells: Record<string, string>
}

const DEFAULT_COLUMNS = ['title', 'tags', 'modified'] as const

export function parseBasesQuery(source: string): BasesQuery {
  const q: BasesQuery = {
    from: null,
    whereTags: [],
    whereFolders: [],
    whereProps: [],
    columns: [...DEFAULT_COLUMNS],
    sortKey: null,
    sortDir: 'asc',
    limit: null,
  }
  let sawColumns = false

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    // From / where folder.
    const mFrom = /^from\s+(.+)$/i.exec(line)
    if (mFrom) { q.from = mFrom[1].trim(); continue }

    const mWhereFolder = /^where\s+folder\s+(.+)$/i.exec(line)
    if (mWhereFolder) { q.whereFolders.push(mWhereFolder[1].trim()); continue }

    const mWhereTag = /^where\s+tag\s+(.+)$/i.exec(line)
    if (mWhereTag) {
      // Strip a leading # if the user typed `#foo`.
      const t = mWhereTag[1].trim().replace(/^#/, '')
      if (t) q.whereTags.push(t.toLowerCase())
      continue
    }

    const mWhereProp = /^where\s+property\s+([A-Za-z_][\w-]*)\s*=\s*(.+)$/i.exec(line)
    if (mWhereProp) {
      q.whereProps.push({ key: mWhereProp[1], value: mWhereProp[2].trim().replace(/^["']|["']$/g, '') })
      continue
    }

    const mCols = /^columns\s*[:=]?\s*(.+)$/i.exec(line)
    if (mCols) {
      const cols = mCols[1].split(',').map(s => s.trim()).filter(Boolean)
      if (cols.length > 0) { q.columns = cols; sawColumns = true }
      continue
    }

    const mSort = /^sort\s+(\S+)(?:\s+(asc|desc))?$/i.exec(line)
    if (mSort) {
      q.sortKey = mSort[1]
      q.sortDir = (mSort[2]?.toLowerCase() === 'desc') ? 'desc' : 'asc'
      continue
    }

    const mLimit = /^limit\s+(\d+)$/i.exec(line)
    if (mLimit) {
      q.limit = parseInt(mLimit[1], 10)
      continue
    }
    // Unknown directive — silently ignore (avoids breaking on typos).
  }

  // If the user didn't specify columns we'll keep the defaults.
  void sawColumns
  return q
}

// Run a parsed query against the noteStore + folderStore state.
export function executeBasesQuery(
  q: BasesQuery,
  notes: Note[],
  folders: Folder[],
): BasesRow[] {
  const byId = new Map(folders.map(f => [f.id, f]))
  function folderPath(folderId: string | null): string {
    if (!folderId) return ''
    const segs: string[] = []
    let cur = byId.get(folderId)
    for (let i = 0; cur && i < 32; i++) {
      if (cur.isDeleted) break
      segs.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return segs.join('/')
  }

  const folderTargets = [q.from, ...q.whereFolders].filter((s): s is string => Boolean(s))

  const filtered = notes.filter(n => {
    if (n.isDeleted) return false
    if (folderTargets.length > 0) {
      const fp = folderPath(n.folderId)
      const matchFolder = folderTargets.some(t => fp === t || fp.startsWith(`${t}/`))
      if (!matchFolder) return false
    }
    if (q.whereTags.length > 0) {
      const tags = extractTags(n.content ?? '').map(t => t.toLowerCase())
      if (!q.whereTags.every(t => tags.includes(t))) return false
    }
    if (q.whereProps.length > 0) {
      const fm = parseFrontmatter(n.content ?? '')
      const fields = new Map(fm.fields.map(f => [f.key, f]))
      for (const { key, value } of q.whereProps) {
        const f = fields.get(key)
        if (!f) return false
        if (!fieldMatches(f, value)) return false
      }
    }
    return true
  })

  const rows: BasesRow[] = filtered.map(n => {
    const fm = parseFrontmatter(n.content ?? '')
    const fieldMap = new Map(fm.fields.map(f => [f.key, f]))
    const cells: Record<string, string> = {}
    for (const col of q.columns) {
      cells[col] = computeCell(col, n, folderPath(n.folderId), fieldMap)
    }
    return {
      noteId: n.id,
      title: n.title || 'Untitled',
      folderPath: folderPath(n.folderId),
      cells,
    }
  })

  if (q.sortKey) {
    const key = q.sortKey
    const dir = q.sortDir === 'desc' ? -1 : 1
    rows.sort((a, b) => {
      const av = a.cells[key] ?? ''
      const bv = b.cells[key] ?? ''
      return dir * av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
    })
  }

  if (q.limit != null) return rows.slice(0, q.limit)
  return rows
}

function computeCell(
  col: string,
  note: Note,
  folderPath: string,
  fieldMap: Map<string, FrontmatterField>,
): string {
  switch (col.toLowerCase()) {
    case 'title':    return note.title || 'Untitled'
    case 'folder':   return folderPath
    case 'path':     return folderPath ? `${folderPath}/${note.title}` : note.title || ''
    case 'tags':     return extractTags(note.content ?? '').join(', ')
    case 'modified': return new Date(note.updatedAt).toISOString().slice(0, 10)
    case 'created':  return new Date(note.createdAt).toISOString().slice(0, 10)
  }
  // Frontmatter lookup (case-sensitive — matches Obsidian).
  const f = fieldMap.get(col)
  if (!f) return ''
  if (Array.isArray(f.value)) return f.value.join(', ')
  if (f.value == null) return ''
  return String(f.value)
}

function fieldMatches(field: FrontmatterField, target: string): boolean {
  if (Array.isArray(field.value)) {
    return field.value.some(v => v.toLowerCase() === target.toLowerCase())
  }
  return String(field.value ?? '').toLowerCase() === target.toLowerCase()
}
