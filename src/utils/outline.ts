// Outline parsing — extract H1–H6 ATX headings from a markdown document.
//
// Rules:
//   * Only ATX headings (`#`-prefixed) are recognised. Setext (`====` /
//     `----`) headings are intentionally ignored for v1.
//   * The `#` chars MUST start at column 1 — indented headings (e.g. inside
//     a list) are not part of the document outline.
//   * Headings inside fenced code blocks (``` or ~~~) are ignored — we
//     track fence state line-by-line.
//   * Empty-text headings (`## ` with nothing after the space) are skipped.
//
// Output is in document order. Line numbers are 1-indexed to match
// CodeMirror's doc.line(n) API.

export interface Heading {
  level: number      // 1..6
  text: string       // heading text with surrounding whitespace trimmed
  line: number       // 1-indexed source line
}

const ATX_HEADING_RE = /^(#{1,6})\s+(\S.*?)\s*#*\s*$/
// Fences: ``` or ~~~ at the start of the line, with at least 3 chars.
// We don't care about info strings — only the fence char and length.
const FENCE_RE = /^(`{3,}|~{3,})/

export function extractHeadings(content: string): Heading[] {
  if (!content) return []
  const lines = content.split('\n')
  const out: Heading[] = []

  let inFence = false
  let fenceChar: '`' | '~' | null = null
  let fenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Fence tracking. A fence opens when we hit ``` or ~~~ outside a fence,
    // and closes only on a matching fence char with length >= the opener.
    const fm = line.match(FENCE_RE)
    if (fm) {
      const ch = fm[1][0] as '`' | '~'
      const len = fm[1].length
      if (!inFence) {
        inFence = true
        fenceChar = ch
        fenceLen = len
        continue
      }
      if (ch === fenceChar && len >= fenceLen) {
        inFence = false
        fenceChar = null
        fenceLen = 0
        continue
      }
      // Inside a fence with a non-matching char — still inside the fence.
      continue
    }

    if (inFence) continue

    const m = line.match(ATX_HEADING_RE)
    if (!m) continue
    const level = m[1].length
    const text = m[2].trim()
    if (!text) continue
    out.push({ level, text, line: i + 1 })
  }

  return out
}
