// Pure logic mirror for the `noteser-kanban` plugin's status
// extraction, column grouping, filter, and Move-to helpers. The
// plugin's `main.js` runs unbundled in the Worker and is intentionally
// self-contained (no relative imports, no SDK runtime dependency), so
// the production code lives there. This file mirrors the same pure
// functions in TypeScript so the Jest tests can import + assert
// without driving the Worker bridge.
//
// Any change to the production logic in
// `public/plugins/noteser-kanban/main.js` MUST land here too.

export interface KanbanNote {
  id: string
  title: string
  folderPath: string
  body: string
  frontmatter: Record<string, unknown> | null
  updatedAt: number
}

/** Default fallback columns when no notes have status frontmatter
 *  yet AND the user has not customised the column list. */
export const DEFAULT_COLUMNS: ReadonlyArray<string> = ['Todo', 'Doing', 'Done']

/** Reserved column used for notes whose frontmatter has no `status`
 *  field, or where the status does not match any user-defined
 *  column. Always rendered on the far right; never reorderable. */
export const UNSORTED_COLUMN = 'Unsorted'

/** Extract the canonical status string from a note's parsed
 *  frontmatter. Returns null when:
 *  - frontmatter is null / missing
 *  - status key is absent
 *  - status value is null / undefined / empty string after trim
 *
 *  Non-string status values (numbers, booleans) are coerced via
 *  String(). Arrays are joined with comma to keep the function
 *  total — Obsidian convention is a single string, but a user mid-
 *  edit may have an array transiently. */
export function extractStatus(note: { frontmatter: Record<string, unknown> | null }): string | null {
  const fm = note.frontmatter
  if (!fm) return null
  if (!Object.prototype.hasOwnProperty.call(fm, 'status')) return null
  const raw = fm.status
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) {
    const joined = raw.map((x) => String(x)).join(', ').trim()
    return joined.length > 0 ? joined : null
  }
  const s = String(raw).trim()
  return s.length > 0 ? s : null
}

/** Parse a user-supplied CSV string into a column list. Trims,
 *  drops empties, dedupes case-insensitively (keeping first
 *  occurrence's casing). When the parsed list is empty the caller
 *  decides the fallback. */
export function parseColumnsCsv(csv: string): string[] {
  if (typeof csv !== 'string') return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of csv.split(',')) {
    const t = piece.trim()
    if (t.length === 0) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** Decide the active column list for a board:
 *  1. user-customised columns (from setting) win;
 *  2. otherwise, the set of statuses that actually appear in the
 *     vault (ordered alphabetically, case-insensitive);
 *  3. otherwise (no notes carry status yet), fall back to the
 *     hard-coded DEFAULT_COLUMNS.
 *
 *  The Unsorted column is appended by the renderer, not by this
 *  function. */
export function resolveColumns(
  notes: ReadonlyArray<{ frontmatter: Record<string, unknown> | null }>,
  customCsv: string | null | undefined,
): string[] {
  const parsed = parseColumnsCsv(customCsv || '')
  if (parsed.length > 0) return parsed

  const seen = new Set<string>()
  const out: string[] = []
  for (const n of notes) {
    const s = extractStatus(n)
    if (s === null) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  if (out.length > 0) {
    out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    return out
  }
  return DEFAULT_COLUMNS.slice()
}

/** Group notes into a map keyed by column name. Notes whose status
 *  does not appear in the column list (or have no status) land in
 *  UNSORTED_COLUMN. The returned object always has an entry for every
 *  declared column plus UNSORTED_COLUMN, even if empty. Column-name
 *  matching is case-insensitive: a note with `status: TODO` lands in
 *  a column named `Todo`. */
export function groupByStatus<T extends { frontmatter: Record<string, unknown> | null }>(
  notes: ReadonlyArray<T>,
  columns: ReadonlyArray<string>,
): Record<string, T[]> {
  const buckets: Record<string, T[]> = {}
  for (const c of columns) buckets[c] = []
  buckets[UNSORTED_COLUMN] = []

  const lookup = new Map<string, string>()
  for (const c of columns) lookup.set(c.toLowerCase(), c)

  for (const n of notes) {
    const s = extractStatus(n)
    if (s === null) {
      buckets[UNSORTED_COLUMN].push(n)
      continue
    }
    const hit = lookup.get(s.toLowerCase())
    if (hit) buckets[hit].push(n)
    else buckets[UNSORTED_COLUMN].push(n)
  }
  return buckets
}

/** Extract `#tag` patterns from a note body. Mirrors the host's
 *  `extractTags` heuristic just enough for filter purposes — the
 *  plugin renders no tags itself, it only matches against them. */
function extractTags(body: string | null | undefined): string[] {
  if (!body) return []
  const out: string[] = []
  const re = /(^|[^\w/])#([A-Za-z][\w-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) out.push(m[2].toLowerCase())
  return out
}

function ciIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** Filter notes by a single user query against title / tag / status.
 *  Empty query returns the input array unchanged (copied). Match
 *  semantics:
 *  - title: substring, case-insensitive
 *  - tags: any `#tag` body match (substring against tag, case-
 *    insensitive)
 *  - status: substring against the extracted status string
 *
 *  Folder paths are NOT searched — the kanban brief lists title /
 *  tag / status only. */
export function filterNotes<T extends KanbanNote>(
  notes: ReadonlyArray<T>,
  query: string,
): T[] {
  const q = (query || '').trim()
  if (q.length === 0) return notes.slice()
  return notes.filter((n) => {
    if (ciIncludes(n.title || '', q)) return true
    const status = extractStatus(n) || ''
    if (ciIncludes(status, q)) return true
    for (const tag of extractTags(n.body)) {
      if (ciIncludes(tag, q)) return true
    }
    return false
  })
}

/** The set of target columns offered by the "Move to" picker for a
 *  card currently in `fromColumn`. Excludes the source column and
 *  always includes UNSORTED_COLUMN (so a user can demote a card back
 *  to "no status"). */
export function moveTargets(
  columns: ReadonlyArray<string>,
  fromColumn: string,
): string[] {
  const out: string[] = []
  for (const c of columns) {
    if (c.toLowerCase() === fromColumn.toLowerCase()) continue
    out.push(c)
  }
  if (fromColumn.toLowerCase() !== UNSORTED_COLUMN.toLowerCase()) {
    out.push(UNSORTED_COLUMN)
  }
  return out
}

/** Build the frontmatter patch that should be written for a move
 *  operation. Preserves every other key in the existing frontmatter.
 *  Moving to UNSORTED_COLUMN removes the `status` key entirely
 *  rather than writing `status: Unsorted` — that keeps the on-disk
 *  YAML clean and matches the Obsidian convention. */
export function buildMovePatch(
  existing: Record<string, unknown> | null,
  targetColumn: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(existing || {}) }
  if (targetColumn.toLowerCase() === UNSORTED_COLUMN.toLowerCase()) {
    delete base.status
    return base
  }
  base.status = targetColumn
  return base
}
