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

// Collect all tags across an array of notes (ignoring deleted notes).
export function collectAllTags(notes: { content?: string; isDeleted?: boolean }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const n of notes) {
    if (n.isDeleted) continue
    for (const tag of extractTags(n.content ?? '')) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return counts
}

export function noteHasTag(content: string, tag: string): boolean {
  return extractTags(content).includes(tag)
}
