// Detect whether the cursor sits inside a typed tag and, if so, return
// the active query + the position of the `#` so the caller can replace
// the right range when the user picks a completion.
//
// A tag starts with `#`, must be preceded by whitespace, line-start, or
// punctuation NOT in [_/-] (matches the parser in tags.ts), and consists
// of [A-Za-z0-9_/-] characters. We allow nested tags (`#work/q1`) so
// `/` inside the body is fine.
//
// Returns null when:
//   - no `#` precedes the cursor on the current line/word
//   - the `#` is followed by a space (tag completed)
//   - the preceding character is itself a tag char (typing inside an
//     already-finished word, e.g. `foo#bar`)

const TAG_BODY = /[A-Za-z0-9_/-]/
const TAG_PRECEDER = /[\s\n\r]|[(){}\[\].,;:!?'"]/

export interface ActiveTagQuery {
  query: string
  start: number // index of the `#`
}

export function getActiveTagQuery(content: string, cursorPos: number): ActiveTagQuery | null {
  if (cursorPos <= 0) return null
  // Walk backward from the cursor until we hit a non-tag-body char.
  let i = cursorPos - 1
  while (i >= 0 && TAG_BODY.test(content[i])) i--
  // i now points at the char BEFORE the run of tag-body chars, or to a
  // `#` if the run was empty. The `#` must be at position i.
  if (i < 0 || content[i] !== '#') return null
  // Validate the char before `#` — must be either start-of-string or a
  // TAG_PRECEDER. This prevents `foo#bar` (continuation of a word)
  // from looking like a tag.
  if (i > 0 && !TAG_PRECEDER.test(content[i - 1])) return null
  const query = content.slice(i + 1, cursorPos)
  return { query, start: i }
}
