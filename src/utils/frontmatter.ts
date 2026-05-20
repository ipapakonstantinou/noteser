// Lightweight YAML frontmatter parser. Strictly a subset of YAML — enough
// to read + write the fields Obsidian's frontmatter UI handles:
//   tags: [a, "b", c]            inline arrays
//   aliases: [Short, "Even-shorter"]
//   title: My Note               scalar strings (bare + double-quoted)
//   draft: true                  booleans
//   priority: 3                  numbers
//   date: 2026-05-20             ISO dates (returned as string)
//
// We deliberately don't pull in `js-yaml` — that would more than double
// our parser footprint and we only need a fixed shape. Anything outside
// the supported grammar is preserved into a `raw` line so save+reload
// doesn't destroy unknown user metadata.

export type FrontmatterValue = string | number | boolean | string[] | null

export interface FrontmatterField {
  key: string
  value: FrontmatterValue
  /** True when the value was an inline array (e.g. `tags: [a, b]`). */
  isArray: boolean
  /** Original line text, used to round-trip unrecognised lines verbatim. */
  raw: string
  /** True when the line failed to parse — caller renders it but doesn't
   *  let the user edit (avoids corruption). */
  isUnknown: boolean
}

export interface ParsedFrontmatter {
  /** True when the content starts with `---\n…\n---\n`. */
  hasFrontmatter: boolean
  /** Parsed fields in source order. Empty when hasFrontmatter is false. */
  fields: FrontmatterField[]
  /** The body text after the closing `---`. Equal to the full input when
   *  hasFrontmatter is false. */
  body: string
}

const FENCE = /^---\r?\n/
const CLOSE_RE = /\n---\r?\n/
const CLOSE_AT_EOF_RE = /\n---\s*$/

export function parseFrontmatter(content: string): ParsedFrontmatter {
  // Normalise CRLF up front so the line-by-line regex doesn't trip on
  // stranded \r in the matched block (Windows / pasted-from-Word notes).
  content = content.replace(/\r\n/g, '\n')
  if (!FENCE.test(content)) {
    return { hasFrontmatter: false, fields: [], body: content }
  }
  // Find the closing fence. Two cases — fenced + body, OR fenced at EOF.
  const afterOpen = content.replace(FENCE, '')
  let closeMatch: { idx: number; end: number } | null = null
  const m1 = afterOpen.match(CLOSE_RE)
  if (m1) {
    closeMatch = { idx: m1.index!, end: m1.index! + m1[0].length }
  } else {
    const m2 = afterOpen.match(CLOSE_AT_EOF_RE)
    if (m2) closeMatch = { idx: m2.index!, end: afterOpen.length }
  }
  if (!closeMatch) {
    return { hasFrontmatter: false, fields: [], body: content }
  }

  const block = afterOpen.slice(0, closeMatch.idx)
  const body = afterOpen.slice(closeMatch.end)
  const fields = block.split(/\r?\n/).filter(line => line.length > 0).map(parseLine)
  return { hasFrontmatter: true, fields, body }
}

function parseLine(line: string): FrontmatterField {
  const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
  if (!m) {
    return { key: '', value: null, isArray: false, raw: line, isUnknown: true }
  }
  const key = m[1]
  const rest = m[2].trim()
  // Inline array — `tags: [a, "b", c]`. Re-uses the parser from githubSync
  // would be circular; we duplicate the small bit of logic here.
  if (rest.startsWith('[') && rest.endsWith(']')) {
    const inner = rest.slice(1, -1).trim()
    if (inner === '') return { key, value: [], isArray: true, raw: line, isUnknown: false }
    const items: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i]
      if (c === '"') { inQuote = !inQuote; continue }
      if (c === ',' && !inQuote) {
        items.push(cur.trim())
        cur = ''
        continue
      }
      cur += c
    }
    if (cur.trim()) items.push(cur.trim())
    return { key, value: items, isArray: true, raw: line, isUnknown: false }
  }
  // Quoted scalar — strip the wrapping quotes.
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
    return { key, value: rest.slice(1, -1), isArray: false, raw: line, isUnknown: false }
  }
  // Boolean.
  if (rest === 'true' || rest === 'false') {
    return { key, value: rest === 'true', isArray: false, raw: line, isUnknown: false }
  }
  // Number.
  if (/^-?\d+(\.\d+)?$/.test(rest)) {
    return { key, value: Number(rest), isArray: false, raw: line, isUnknown: false }
  }
  // Plain scalar — store verbatim (covers ISO dates, identifiers, etc).
  return { key, value: rest, isArray: false, raw: line, isUnknown: false }
}

// Serialize fields back into a frontmatter block (no fences). Unknown
// lines round-trip verbatim via their `raw` so we don't lose anything
// the parser couldn't model.
export function serializeFrontmatterFields(fields: FrontmatterField[]): string {
  return fields.map(f => {
    if (f.isUnknown) return f.raw
    if (f.isArray) {
      const items = (f.value as string[]).map(s => /[,\s"]/.test(s) ? `"${s}"` : s)
      return `${f.key}: [${items.join(', ')}]`
    }
    if (f.value === null) return `${f.key}: `
    if (typeof f.value === 'string') {
      // Quote when the string contains a colon or starts with a special char.
      return /[:\s#]/.test(f.value) ? `${f.key}: "${f.value}"` : `${f.key}: ${f.value}`
    }
    return `${f.key}: ${String(f.value)}`
  }).join('\n')
}

// Replace the frontmatter block of `content` with the given fields. If the
// content has no frontmatter, prepend one. If `fields` is empty, strip the
// existing block entirely.
export function writeFrontmatter(content: string, fields: FrontmatterField[]): string {
  const parsed = parseFrontmatter(content)
  if (fields.length === 0) {
    return parsed.hasFrontmatter ? parsed.body : content
  }
  const block = serializeFrontmatterFields(fields)
  const rawBody = parsed.hasFrontmatter ? parsed.body : content
  // Output convention: exactly one `\n` between the closing fence and the
  // first body character. Strip any leading newlines so we don't end up
  // with a blank line right after the fence.
  const body = rawBody.replace(/^\n+/, '')
  return `---\n${block}\n---\n${body}`
}
