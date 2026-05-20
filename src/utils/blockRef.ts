// Helpers for the "Copy block ref" command (e4t8 v2).
//
// Obsidian's block-ref convention: any line ending with `^block-id` can
// be linked via `[[Note#^block-id]]`. The user shouldn't have to remember
// + type the marker — we mint it when missing, append it to the source
// line, and hand back the canonical link string for the clipboard.

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ID_LENGTH = 6

// Generate a short base36 id, e.g. "9k4xq2". Uses crypto.getRandomValues
// when available + falls back to Math.random for jsdom / very old
// runtimes. Collisions within one note are unlikely (36^6 ≈ 2.2B); we
// don't dedupe defensively.
export function generateBlockId(): string {
  let out = ''
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(ID_LENGTH)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < ID_LENGTH; i++) {
      out += ID_CHARS[bytes[i] % ID_CHARS.length]
    }
    return out
  }
  for (let i = 0; i < ID_LENGTH; i++) {
    out += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
  }
  return out
}

// Detect a trailing `^id` token on a line. Match must be preceded by
// whitespace OR start-of-line (so a stray ^foo mid-paragraph isn't a
// false positive, mirroring findFragmentLine in wikilinkTarget.ts).
//
// Returns the id (without the `^`) or null when not present.
export function extractTrailingBlockId(line: string): string | null {
  const m = /(?:^|\s)\^([\w-]+)\s*$/.exec(line)
  return m ? m[1] : null
}

// Append `^id` to a line. Inserts exactly one space between the existing
// content and the marker so the line doesn't end up like `foo^id`. If
// the line is empty (whitespace only) we still write the marker — that
// matches Obsidian where you can have an "anchor-only" line.
export function appendBlockId(line: string, id: string): string {
  const trimmed = line.replace(/\s+$/, '')
  if (trimmed === '') return `^${id}`
  return `${trimmed} ^${id}`
}

// Build the canonical `[[Title#^id]]` link string used in the clipboard.
export function buildBlockRefLink(noteTitle: string, id: string): string {
  return `[[${noteTitle}#^${id}]]`
}
