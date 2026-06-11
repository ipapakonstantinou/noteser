// Paste-URL-to-titled-link helpers (Obsidian "Auto Link Title" parity).
//
// Three paste shapes feed this module (wired up in CodeMirrorEditor):
//   1. URL pasted over a selection      → `[selection](url)` — no network
//   2. URL pasted with an HTML anchor   → `[anchor text](url)` — no network
//      alongside it in the clipboard (copying a link element gives this)
//   3. Bare URL pasted on its own       → placeholder inserted, then
//      /api/link-title fetches the page <title> and splices it in
//
// Everything here is pure string work (regex, not DOMParser) so the same
// helpers run in the browser, in jsdom tests, and in the Node API route.

/** Placeholder title shown while the real page title is being fetched. */
export const FETCHING_TITLE_PLACEHOLDER = 'Fetching title…'

const MAX_TITLE_CHARS = 200

/** True when `text` is a single-line http(s) URL and nothing else. */
export function isBareUrl(text: string): boolean {
  const t = text.trim()
  if (!/^https?:\/\/\S+$/i.test(t)) return false
  try {
    new URL(t)
    return true
  } catch {
    return false
  }
}

/**
 * Sanitize arbitrary page-title text for use inside `[...](url)`:
 * collapse whitespace (titles often contain newlines + indentation),
 * escape the bracket characters that would terminate the link early,
 * and cap the length so a bloated <title> doesn't flood the note.
 */
export function sanitizeLinkTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  const capped = collapsed.length > MAX_TITLE_CHARS ? `${collapsed.slice(0, MAX_TITLE_CHARS - 1)}…` : collapsed
  return capped.replace(/([[\]])/g, '\\$1')
}

/** Build a markdown link, sanitizing the title. */
export function markdownLink(title: string, url: string): string {
  return `[${sanitizeLinkTitle(title)}](${url})`
}

/**
 * Extract the single anchor from a clipboard `text/html` flavor.
 * Returns null when the fragment has zero or multiple anchors, or when
 * the anchor has no usable text (e.g. it wraps an image).
 */
export function anchorFromHtml(html: string): { href: string; text: string } | null {
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)]
  if (anchors.length !== 1) return null
  const href = anchors[0][2] ?? anchors[0][3] ?? ''
  const text = decodeEntities(stripTags(anchors[0][4])).replace(/\s+/g, ' ').trim()
  if (!href || !text) return null
  return { href, text }
}

/**
 * Pull a human title out of a fetched HTML document: `og:title` wins
 * (sites put the clean name there), falling back to `<title>`.
 * Returns null when neither yields usable text.
 */
export function extractHtmlTitle(html: string): string | null {
  // <meta property="og:title" content="..."> — attribute order varies.
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of metaTags) {
    if (!/(?:property|name)\s*=\s*["']og:title["']/i.test(tag)) continue
    const content = tag.match(/content\s*=\s*("([^"]*)"|'([^']*)')/i)
    const value = decodeEntities((content?.[2] ?? content?.[3] ?? '')).replace(/\s+/g, ' ').trim()
    if (value) return value
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (title) {
    const value = decodeEntities(stripTags(title[1])).replace(/\s+/g, ' ').trim()
    if (value) return value
  }
  return null
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}
