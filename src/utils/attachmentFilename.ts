// Pure filename generation for pasted/dropped/attached images (#124).
//
// Kept free of IDB/store imports on purpose — the pattern-expansion and
// collision policy are unit-tested directly (attachmentFilename.test.ts)
// without mocking storage. `attachments.ts` supplies the real existence
// check when calling `resolveAttachmentFilename`.
//
// Supported tokens: {date} / {date:FORMAT} (FORMAT uses the dateFormat.ts
// tokens, e.g. {date:YYYY-MM-DD}), {noteTitle}, {originalName}, {counter}.
// The file extension always comes from the original file — it is appended
// after pattern expansion, not part of the pattern itself.

import { formatDate } from './dateFormat'

// Reproduces the pre-#124 default: `<YYYYMMDDHHmmss>-<original name>`.
export const DEFAULT_ATTACHMENT_FILENAME_PATTERN = '{date}-{originalName}'

export interface AttachmentFilenameContext {
  now: Date
  noteTitle: string
  originalName: string
}

const TOKEN_RE = /\{date(?::([^}]+))?\}|\{noteTitle\}|\{originalName\}|\{counter\}/g

// Legacy default date token — kept distinct from dateFormat.ts because that
// formatter has no hour/minute/second tokens (daily/weekly notes never
// needed them).
function legacyTimestamp(date: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

// Strip directory separators and filesystem-unsafe characters, collapse
// whitespace. Mirrors attachments.ts's sanitizeAttachmentName policy.
function sanitizeSegment(value: string): string {
  return value.replace(/[\\/]/g, '-').replace(/[<>:"|?*]/g, '').replace(/\s+/g, ' ').trim()
}

function splitExt(name: string): [stem: string, ext: string] {
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx <= 0) return [name, '']
  return [name.slice(0, dotIdx), name.slice(dotIdx)]
}

// Expand `pattern` against `ctx` for one `counter` value. Pure: identical
// inputs always produce the identical filename.
export function buildAttachmentFilename(
  pattern: string,
  ctx: AttachmentFilenameContext,
  counter: number,
): string {
  const originalBase = ctx.originalName.replace(/\\/g, '/').split('/').pop() || ctx.originalName
  const [originalStem, ext] = splitExt(originalBase)

  const expanded = pattern.replace(TOKEN_RE, (match, dateFormat?: string) => {
    if (match.startsWith('{date')) {
      return dateFormat ? formatDate(ctx.now, dateFormat) : legacyTimestamp(ctx.now)
    }
    switch (match) {
      case '{noteTitle}': return ctx.noteTitle
      case '{originalName}': return originalStem
      case '{counter}': return String(counter)
      default: return match
    }
  })

  const safeStem = sanitizeSegment(expanded) || 'image'
  const safeExt = ext.replace(/[<>:"|?*]/g, '')
  return `${safeStem}${safeExt}`
}

// Resolve `pattern` to a filename that doesn't collide, probing `exists`
// (checked against whatever namespace the caller cares about — attachments.ts
// passes a per-directory check) and incrementing a counter until a free slot
// is found.
//
// If `pattern` references {counter}, that token is what gets bumped on each
// retry. Otherwise (the default pattern has no {counter}) collisions are
// disambiguated by appending `-<n>` before the extension — this is the same
// fallback saveAttachment always used pre-#124 for sub-second paste bursts.
export async function resolveAttachmentFilename(
  pattern: string,
  ctx: AttachmentFilenameContext,
  exists: (name: string) => boolean | Promise<boolean>,
): Promise<string> {
  const usesCounterToken = pattern.includes('{counter}')
  const base = buildAttachmentFilename(pattern, ctx, 1)
  if (!(await exists(base))) return base

  if (usesCounterToken) {
    let counter = 2
    let candidate = buildAttachmentFilename(pattern, ctx, counter)
    while (await exists(candidate)) {
      counter++
      candidate = buildAttachmentFilename(pattern, ctx, counter)
    }
    return candidate
  }

  const [stem, ext] = splitExt(base)
  let counter = 1
  let candidate = `${stem}-${counter}${ext}`
  while (await exists(candidate)) {
    counter++
    candidate = `${stem}-${counter}${ext}`
  }
  return candidate
}
