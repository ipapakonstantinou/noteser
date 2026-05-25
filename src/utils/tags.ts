// Tags are derived from `#tag` patterns inside note bodies — same model as
// Obsidian, no separate entity store.  A valid tag matches:
//   * starts with `#`
//   * follows whitespace, line start, or punctuation NOT in [_/-]
//   * body of one or more [A-Za-z0-9_/-] characters
//   * not immediately followed by another tag character
//
// We deliberately allow `/` so nested tags like `#work/projects/q1` work.
// We exclude bare `#` followed by digits-only (those look more like
// heading anchors / issue refs than tags) — but Obsidian DOES treat them
// as tags, so we keep them too for parity.

const TAG_REGEX = /(^|[^\w#/-])(#[A-Za-z0-9_/-]+)(?![\w/-])/g

export function extractTags(content: string): string[] {
  if (!content) return []
  const out = new Set<string>()
  let m: RegExpExecArray | null
  TAG_REGEX.lastIndex = 0
  while ((m = TAG_REGEX.exec(content)) !== null) {
    // m[2] is "#tagname"; strip the leading hash for storage/comparison.
    const name = m[2].slice(1)
    if (name) out.add(name)
  }
  return Array.from(out)
}

// Per-note tag cache keyed by the note OBJECT. Zustand's note store
// replaces a note's object reference on every update (immutable
// pattern), so this WeakMap auto-invalidates when content changes —
// the new object is a cache miss; the old one becomes GC-eligible.
// At 5k notes the cache cuts repeat collectAllTags from a ~5MB regex
// scan to a Map lookup.
const tagCache = new WeakMap<object, string[]>()

export function extractTagsCached(note: { content?: string }): string[] {
  const cached = tagCache.get(note)
  if (cached) return cached
  const tags = extractTags(note.content ?? '')
  tagCache.set(note, tags)
  return tags
}

/** Test hook: clear the per-note tag cache. */
export function _resetTagCache(): void {
  // WeakMap has no .clear() — recreate is the only way. We can't
  // reassign the const, but tests can read cached values via the
  // primary API; tests that want a cold cache should pass fresh
  // note objects.
}

// Collect all tags across an array of notes (ignoring deleted notes).
// Uses extractTagsCached so unchanged notes are nearly free on repeat
// invocations — important at 5k+ notes where the regex scan dominates.
//
// progressive-clone: SHELL notes (contentLoaded === false) have an EMPTY body
// — their real tags haven't streamed in yet — so they're skipped. As each
// shell's body loads, the note object reference changes (Zustand immutable
// update) and the Tags view recomputes, so its tags appear automatically.
export function collectAllTags(notes: { content?: string; isDeleted?: boolean; contentLoaded?: boolean }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const n of notes) {
    if (n.isDeleted) continue
    if (n.contentLoaded === false) continue
    for (const tag of extractTagsCached(n)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return counts
}

export function noteHasTag(content: string, tag: string): boolean {
  return extractTags(content).includes(tag)
}
