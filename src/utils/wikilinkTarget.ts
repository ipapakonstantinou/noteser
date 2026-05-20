// Helpers for resolving block + heading fragments inside a note body.
// Used by the wikilink Ctrl+Click handler + the rendered-preview link
// click handler to scroll to the right line after navigating to the
// target note.
//
// Two fragment shapes Obsidian supports:
//   [[Note#Heading text]]   → first heading whose text matches
//   [[Note#^block-id]]      → line ending with `^block-id`

export interface ParsedWikilinkTarget {
  title: string
  /** Fragment after the `#`, or null when the link points at the note itself. */
  fragment: string | null
}

// Split a wikilink target into title + optional fragment. The fragment
// keeps its leading `^` for block refs so the resolver can branch on it.
export function parseWikilinkTarget(raw: string): ParsedWikilinkTarget {
  const trimmed = raw.trim()
  const hash = trimmed.indexOf('#')
  if (hash === -1) return { title: trimmed, fragment: null }
  return {
    title: trimmed.slice(0, hash).trim(),
    fragment: trimmed.slice(hash + 1).trim() || null,
  }
}

// Find the 0-based line index of the heading/block-id fragment in a note's
// content. Returns null when nothing matches.
export function findFragmentLine(content: string, fragment: string): number | null {
  if (!content) return null
  const lines = content.split(/\r?\n/)
  // Block reference (^block-id) — last token on a line, anywhere.
  if (fragment.startsWith('^')) {
    const target = fragment.toLowerCase()
    for (let i = 0; i < lines.length; i++) {
      // Match a trailing `^id` token (preceded by whitespace OR start of line).
      const m = /(?:^|\s)(\^[\w-]+)\s*$/.exec(lines[i])
      if (m && m[1].toLowerCase() === target) return i
    }
    return null
  }
  // Heading reference — first ATX heading whose text matches.
  const wantedText = normaliseHeading(fragment)
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i])
    if (!h) continue
    if (normaliseHeading(h[1]) === wantedText) return i
  }
  return null
}

function normaliseHeading(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Encode a {title, fragment} pair back into the `wikilink://...` href used
// by renderWikilinks. Fragment goes into the `frag` query param.
export function encodeWikilinkHref(title: string, fragment: string | null): string {
  const base = `wikilink://${encodeURIComponent(title)}`
  return fragment
    ? `${base}?frag=${encodeURIComponent(fragment)}`
    : base
}

// Decode the inverse — accept either the new query-param form OR the bare
// form. Returns null when the href isn't a wikilink.
export function decodeWikilinkHref(href: string): ParsedWikilinkTarget | null {
  if (!href.startsWith('wikilink://')) return null
  const rest = href.slice('wikilink://'.length)
  const qIdx = rest.indexOf('?')
  if (qIdx === -1) {
    return { title: decodeURIComponent(rest), fragment: null }
  }
  const titlePart = decodeURIComponent(rest.slice(0, qIdx))
  const params = new URLSearchParams(rest.slice(qIdx + 1))
  const frag = params.get('frag')
  return { title: titlePart, fragment: frag ? decodeURIComponent(frag) : null }
}
