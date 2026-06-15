// Pure logic mirror for the `noteser-properties` plugin's
// frontmatter type inference, filter, and sort code. The plugin's
// `main.js` runs unbundled in the Worker and is intentionally
// self-contained (no relative imports, no SDK runtime dependency),
// so the production code lives there. This file mirrors the same
// pure functions in TypeScript so the Jest tests can import + assert
// without driving the Worker bridge.
//
// Any change to the inference / filter / sort code in
// `public/plugins/noteser-properties/main.js` MUST land here too.

export interface NoteFixture {
  id: string
  title: string
  folderPath: string
  body: string
  frontmatter: Record<string, unknown> | null
  updatedAt: number
}

export type ColumnType = 'string' | 'number' | 'date' | 'tag-array' | 'boolean' | 'empty'

export interface Column {
  key: string
  type: ColumnType
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

export function inferValueType(v: unknown): ColumnType {
  if (v === null || v === undefined) return 'empty'
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string')) return 'tag-array'
    return 'string'
  }
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number' && Number.isFinite(v)) return 'number'
  if (typeof v === 'string') {
    if (v.length === 0) return 'empty'
    if (ISO_DATE_RE.test(v)) return 'date'
    if (/^-?\d+(\.\d+)?$/.test(v)) return 'number'
    return 'string'
  }
  return 'string'
}

export function reduceColumnType(seen: Set<ColumnType>): ColumnType {
  if (seen.has('tag-array')) return 'tag-array'
  const real = new Set([...seen].filter((t) => t !== 'empty'))
  if (real.size === 0) return 'string'
  if (real.size === 1) return [...real][0]
  return 'string'
}

export function inferColumns(notes: ReadonlyArray<NoteFixture>): Column[] {
  const keyTypes = new Map<string, Set<ColumnType>>()
  for (const n of notes) {
    const fm = n.frontmatter || {}
    for (const [k, v] of Object.entries(fm)) {
      if (!keyTypes.has(k)) keyTypes.set(k, new Set())
      keyTypes.get(k)!.add(inferValueType(v))
    }
  }
  const cols: Column[] = []
  for (const [key, seen] of keyTypes) {
    const hasReal = [...seen].some((t) => t !== 'empty')
    if (!hasReal) continue
    cols.push({ key, type: reduceColumnType(seen) })
  }
  cols.sort((a, b) => {
    if (a.key === 'tags') return -1
    if (b.key === 'tags') return 1
    return a.key.localeCompare(b.key)
  })
  return cols
}

export function valueToText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return ''
    }
  }
  return String(v)
}

function ciIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

export function filterNotes(
  notes: ReadonlyArray<NoteFixture>,
  filter: string,
): NoteFixture[] {
  const q = (filter || '').trim()
  if (q.length === 0) return notes.slice()
  return notes.filter((n) => {
    if (ciIncludes(n.title || '', q)) return true
    if (ciIncludes(n.folderPath || '', q)) return true
    const fm = n.frontmatter || {}
    for (const v of Object.values(fm)) {
      if (ciIncludes(valueToText(v), q)) return true
    }
    return false
  })
}

export function compareForType(type: ColumnType, a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (type === 'number') {
    const na = typeof a === 'number' ? a : Number(a)
    const nb = typeof b === 'number' ? b : Number(b)
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0
    if (Number.isNaN(na)) return 1
    if (Number.isNaN(nb)) return -1
    return na - nb
  }
  if (type === 'date') {
    const ta = Date.parse(String(a))
    const tb = Date.parse(String(b))
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
    if (Number.isNaN(ta)) return 1
    if (Number.isNaN(tb)) return -1
    return ta - tb
  }
  if (type === 'tag-array') {
    const sa = Array.isArray(a) ? a.join(', ') : String(a)
    const sb = Array.isArray(b) ? b.join(', ') : String(b)
    return sa.localeCompare(sb)
  }
  return String(a).localeCompare(String(b))
}

export function sortNotes(
  notes: ReadonlyArray<NoteFixture>,
  columns: ReadonlyArray<Column>,
  sortKey: string,
  direction: 'asc' | 'desc',
): NoteFixture[] {
  const out = notes.slice()
  if (sortKey === '_title') {
    out.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  } else if (sortKey === '_folder') {
    out.sort((a, b) => (a.folderPath || '').localeCompare(b.folderPath || ''))
  } else {
    const col = columns.find((c) => c.key === sortKey)
    const type = col ? col.type : 'string'
    out.sort((a, b) => {
      const va = a.frontmatter ? a.frontmatter[sortKey] : undefined
      const vb = b.frontmatter ? b.frontmatter[sortKey] : undefined
      return compareForType(type, va, vb)
    })
  }
  if (direction === 'desc') out.reverse()
  return out
}

export function coerceEditedValue(prevValue: unknown, raw: unknown): unknown {
  if (raw === undefined || raw === null) return ''
  const s = String(raw)
  if (Array.isArray(prevValue)) {
    return s.split(',').map((p) => p.trim()).filter((p) => p.length > 0)
  }
  if (typeof prevValue === 'number') {
    const n = Number(s)
    return Number.isFinite(n) ? n : s
  }
  if (typeof prevValue === 'boolean') {
    if (s === 'true') return true
    if (s === 'false') return false
    return s
  }
  return s
}

export function tableToMarkdown(
  columns: ReadonlyArray<Column>,
  rows: ReadonlyArray<NoteFixture>,
): string {
  const headers = ['Title', 'Folder', ...columns.map((c) => c.key)]
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ]
  for (const r of rows) {
    const cells = [
      r.title || '',
      r.folderPath || '',
      ...columns.map((c) => {
        const v = r.frontmatter ? r.frontmatter[c.key] : undefined
        return valueToText(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
      }),
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}
