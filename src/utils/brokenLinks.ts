// Broken/dead wikilink detection — scans every non-deleted note for
// `[[Target]]` / `![[Target]]` occurrences that don't resolve to an
// existing note (by title or alias, case-insensitive — same rule as
// findNoteByTitleOrAlias) or a known attachment. Grouped by source note so
// the panel can mirror findBacklinks' shape.
//
// Occurrences inside fenced code blocks are skipped — unlike findBacklinks
// (which counts them, see backlinks.ts), a fenced `[[Target]]` is example
// text, not a real link, so flagging it as broken would be a false positive.

import type { Note } from '@/types'
import { extractWikilinkOccurrences } from './wikilinks'
import { findNoteByTitleOrAlias } from './aliases'

export interface BrokenLink {
  target: string
  fragment: string | null
  isEmbed: boolean
  line: number
}

export interface BrokenLinksResult {
  noteId: string
  title: string
  links: BrokenLink[]
}

export interface FindBrokenWikilinksOptions {
  /** Resolve a bare attachment name/path to a known stored path, or null.
   *  Callers wire this to attachments.resolveAttachmentPath; tests pass a
   *  stub. Omitted entirely, every link is checked against notes only. */
  resolveAttachment?: (target: string) => string | null
}

const FENCE_RE = /^(`{3,}|~{3,})/

// Line numbers (1-indexed) that fall inside a fenced code block. Mirrors the
// fence state machine in outline.ts.
function fencedLines(content: string): Set<number> {
  const fenced = new Set<number>()
  const lines = content.split('\n')
  let inFence = false
  let fenceChar: string | null = null
  let fenceLen = 0
  for (let i = 0; i < lines.length; i++) {
    const fm = lines[i].match(FENCE_RE)
    if (fm) {
      const ch = fm[1][0]
      const len = fm[1].length
      if (!inFence) {
        inFence = true
        fenceChar = ch
        fenceLen = len
        fenced.add(i + 1)
        continue
      }
      if (ch === fenceChar && len >= fenceLen) {
        fenced.add(i + 1)
        inFence = false
        fenceChar = null
        fenceLen = 0
        continue
      }
      fenced.add(i + 1)
      continue
    }
    if (inFence) fenced.add(i + 1)
  }
  return fenced
}

export function findBrokenWikilinks(
  notes: Note[],
  options: FindBrokenWikilinksOptions = {},
): BrokenLinksResult[] {
  const { resolveAttachment } = options
  const out: BrokenLinksResult[] = []

  for (const note of notes) {
    if (note.isDeleted) continue
    const content = note.content ?? ''
    if (!content || content.indexOf('[[') === -1) continue

    const fenced = fencedLines(content)
    const links: BrokenLink[] = []

    for (const occ of extractWikilinkOccurrences(content)) {
      if (fenced.has(occ.line)) continue
      if (!occ.title) continue
      if (findNoteByTitleOrAlias(notes, occ.title)) continue
      if (resolveAttachment?.(occ.title)) continue

      links.push({
        target: occ.title,
        fragment: occ.fragment,
        isEmbed: occ.isEmbed,
        line: occ.line,
      })
    }

    if (links.length > 0) {
      out.push({ noteId: note.id, title: note.title || '(untitled)', links })
    }
  }

  return out
}
