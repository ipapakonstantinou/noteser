// Note aliases — Obsidian-style. A note can declare alternative names via
// YAML frontmatter:
//
//   ---
//   aliases: [Short, "Even Shorter"]
//   ---
//
// `[[Short]]` then resolves to that note even though `Short` is not the title.
// Aliases live inline in the note body (we don't store them on the Note entity
// — content remains the source of truth), so we re-parse on demand and memoise
// per-content to keep wikilink resolution and autocomplete cheap on rerenders.

import type { Note } from '@/types'
import { parseNote } from './githubSync'

// Memoise the alias array per note. Invalidate when the note's content changes
// (we use the content string itself as the cache key — strings are interned by
// the engine, so a fresh identical string still compares equal, and reference
// equality on the prior string is enough to skip re-parsing on rerenders that
// don't touch the body).
const aliasCache = new Map<string, { content: string; aliases: string[] }>()

export function getAliasesForNote(note: Note): string[] {
  const content = note.content ?? ''
  const cached = aliasCache.get(note.id)
  if (cached && cached.content === content) return cached.aliases

  // Only the frontmatter slice matters, but parseNote already handles the
  // "no frontmatter at all" fast path, so we just delegate.
  const aliases = parseNote(content).aliases
  aliasCache.set(note.id, { content, aliases })
  return aliases
}

// Test-only: drop the memo so unit tests can assert content-change invalidation
// behaviour without relying on test execution order.
export function _clearAliasCache(): void {
  aliasCache.clear()
}

// Case-insensitive lookup by title OR any declared alias. Returns the first
// match (titles are checked first so a note's own title always wins over an
// alias on some other note). Used by:
//   - wikilink resolution (Ctrl+Click in CodeMirror, anchor click in preview)
//   - autocomplete filtering
//
// Active-only filtering is the caller's responsibility — pass them in.
export function findNoteByTitleOrAlias(
  notes: Note[],
  query: string,
): Note | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined

  // Pass 1: exact title match. Cheap and the common case.
  const byTitle = notes.find(n => (n.title ?? '').toLowerCase() === q)
  if (byTitle) return byTitle

  // Pass 2: alias match. This requires parsing each note's frontmatter, but
  // getAliasesForNote memoises, so steady-state cost is a Map lookup per note.
  for (const n of notes) {
    const aliases = getAliasesForNote(n)
    if (aliases.some(a => a.toLowerCase() === q)) return n
  }
  return undefined
}
