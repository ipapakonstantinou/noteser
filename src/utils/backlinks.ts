// Backlinks — find every note whose body wikilinks back to a target note.
//
// A wikilink is `[[Title]]` or `[[Title|Display]]`. We only match on the
// pre-pipe portion (the "real" target). A note is considered a backlink to
// `target` when ANY of its `[[...]]` queries case-insensitively equals
// `target.title` OR any of `target`'s declared aliases (via
// `getAliasesForNote`).
//
// We don't try to parse out fenced code blocks — for v1 a `[[Target]]` inside
// a ``` block still counts (see the task spec). Keeps the scanner simple and
// fast.

import type { Note } from '@/types'
import { getAliasesForNote } from './aliases'

export interface BacklinkSnippet {
  /** 1-indexed line where the matching `[[…]]` occurs. */
  line: number
  /** ~120 chars of surrounding text. The matching `[[…]]` is preserved
   *  verbatim — callers highlight it themselves. */
  text: string
}

export interface BacklinkResult {
  noteId: string
  title: string
  snippets: BacklinkSnippet[]
}

// All `[[query]]` or `[[query|display]]` occurrences. We only care about the
// query (pre-pipe) portion. Mirror of the regex in src/utils/wikilinks.ts but
// kept local so changes here don't ripple.
const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g

const MAX_SNIPPETS_PER_NOTE = 3
const SNIPPET_RADIUS = 60 // chars on each side of the match → ~120 chars total

/**
 * Scan every non-deleted note in `notes` for wikilinks that resolve to
 * `targetNote` (title OR alias, case-insensitive). Returns one entry per
 * linking note with up to 3 snippets each. The target note itself is excluded.
 */
export function findBacklinks(notes: Note[], targetNote: Note): BacklinkResult[] {
  const titles = new Set<string>()
  const title = (targetNote.title ?? '').trim().toLowerCase()
  if (title) titles.add(title)
  for (const alias of getAliasesForNote(targetNote)) {
    const a = alias.trim().toLowerCase()
    if (a) titles.add(a)
  }
  // No identifier to match against → no backlinks possible.
  if (titles.size === 0) return []

  const out: BacklinkResult[] = []

  for (const note of notes) {
    if (note.isDeleted) continue
    if (note.id === targetNote.id) continue
    const content = note.content ?? ''
    if (!content) continue
    // Cheap reject: if `[[` doesn't appear at all, skip the regex.
    if (content.indexOf('[[') === -1) continue

    const snippets: BacklinkSnippet[] = []
    WIKILINK_REGEX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = WIKILINK_REGEX.exec(content)) !== null) {
      const query = m[1].trim().toLowerCase()
      if (!titles.has(query)) continue
      if (snippets.length >= MAX_SNIPPETS_PER_NOTE) break

      const matchStart = m.index
      const sliceStart = Math.max(0, matchStart - SNIPPET_RADIUS)
      const sliceEnd = Math.min(content.length, matchStart + m[0].length + SNIPPET_RADIUS)
      let text = content.slice(sliceStart, sliceEnd)
      if (sliceStart > 0) text = '…' + text
      if (sliceEnd < content.length) text = text + '…'
      // Collapse newlines so the snippet renders cleanly on a single line.
      text = text.replace(/\s+/g, ' ').trim()

      // 1-indexed line of the match.
      let line = 1
      for (let i = 0; i < matchStart; i++) {
        if (content.charCodeAt(i) === 10 /* \n */) line++
      }

      snippets.push({ line, text })
    }

    if (snippets.length > 0) {
      out.push({
        noteId: note.id,
        title: note.title || '(untitled)',
        snippets,
      })
    }
  }

  return out
}
