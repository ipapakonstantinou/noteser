// Obsidian-style `![[Title]]` transclusion. Replaces every embed reference
// with the resolved note's content (blockquoted, with a header). Embeds
// inside embeds are expanded recursively up to MAX_EMBED_DEPTH to prevent
// infinite loops when notes reference each other.
//
// Pure function — caller provides the notes array, this utility doesn't
// touch any store. Same shape as renderWikilinks so callers can chain:
//   const expanded = expandEmbeds(content, notes)
//   const linked   = renderWikilinks(expanded)

import type { Note } from '@/types'
import { findNoteByTitleOrAlias } from './aliases'

export const MAX_EMBED_DEPTH = 4

const EMBED_REGEX = /!\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g

export interface ExpandOptions {
  maxDepth?: number
  /** Internal: tracks currently-expanding titles for cycle detection. */
  _visited?: Set<string>
  /** Internal: current depth (root = 0). */
  _depth?: number
}

// Expand every `![[Title]]` reference recursively. On a missing target or
// detected cycle we emit a one-line italic callout in place of the embed
// instead of leaving the raw `![[ ]]` in the output — that way the reader
// sees something is wrong without having to know the syntax.
export function expandEmbeds(
  content: string,
  notes: Note[],
  opts: ExpandOptions = {},
): string {
  const maxDepth = opts.maxDepth ?? MAX_EMBED_DEPTH
  const visited = opts._visited ?? new Set<string>()
  const depth = opts._depth ?? 0

  return content.replace(EMBED_REGEX, (_, rawTitle: string) => {
    const title = rawTitle.trim()
    if (!title) return `*[missing embed]*`

    if (depth >= maxDepth) {
      return `*[embed too deep: \`${escapeMd(title)}\`]*`
    }

    const cycleKey = title.toLowerCase()
    if (visited.has(cycleKey)) {
      return `*[circular embed: \`${escapeMd(title)}\`]*`
    }

    const target = findNoteByTitleOrAlias(notes, title)
    if (!target) {
      return `*[no note found for \`${escapeMd(title)}\`]*`
    }

    const body = target.content ?? ''
    // Recurse so an embed inside the resolved note also expands. The
    // `visited` set carries the active expansion chain so an A→B→A loop
    // breaks at the second A.
    const nextVisited = new Set(visited)
    nextVisited.add(cycleKey)
    const expanded = expandEmbeds(body, notes, {
      maxDepth,
      _visited: nextVisited,
      _depth: depth + 1,
    })

    return formatEmbed(target.title, expanded)
  })
}

// Render the embedded content as a blockquote with a header line. Each
// embedded line is prefixed with `> ` so markdown parsers (CommonMark +
// remark-gfm) render the whole block as a single blockquote.
function formatEmbed(title: string, body: string): string {
  const safeTitle = title.trim() || 'Untitled'
  const header = `> **📎 [[${safeTitle}]]**`
  if (!body.trim()) {
    return `${header}\n>\n> _(empty note)_`
  }
  const quoted = body
    .split(/\r?\n/)
    .map(line => line.length === 0 ? '>' : `> ${line}`)
    .join('\n')
  return `${header}\n>\n${quoted}`
}

function escapeMd(s: string): string {
  return s.replace(/[`*_]/g, '\\$&')
}

// Extract every embed reference's title without expanding. Used by the
// backlinks panel so a note that embeds another note shows up there too.
export function extractEmbedTitles(content: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  EMBED_REGEX.lastIndex = 0
  while ((m = EMBED_REGEX.exec(content)) !== null) {
    out.push(m[1].trim())
  }
  return out
}
