// Check if cursor is inside [[... (no closing ]] yet) — used for autocomplete
export function getActiveWikilinkQuery(
  content: string,
  cursorPos: number
): { query: string; start: number } | null {
  const beforeCursor = content.slice(0, cursorPos)
  const openIdx = beforeCursor.lastIndexOf('[[')
  if (openIdx === -1) return null

  const after = beforeCursor.slice(openIdx + 2)
  // Bail out if already closed, has a pipe (display text portion), or spans lines
  if (after.includes(']]') || after.includes('|') || after.includes('\n')) return null

  return { query: after, start: openIdx }
}

// Replace [[title]], [[title|display]], [[title#heading]], [[title#^block]]
// with markdown links for ReactMarkdown. Fragments after `#` are kept on
// the wikilink:// href as a `?frag=` query param so the consumer can scroll
// to a heading or block ref after navigating.
export function renderWikilinks(content: string): string {
  return content.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, rawTitle, display) => {
    const target = rawTitle.trim()
    const hash = target.indexOf('#')
    const title = hash === -1 ? target : target.slice(0, hash).trim()
    const fragment = hash === -1 ? null : target.slice(hash + 1).trim() || null
    const text = (display?.trim() || target).replace(/[[\]]/g, '')
    const href = fragment
      ? `wikilink://${encodeURIComponent(title)}?frag=${encodeURIComponent(fragment)}`
      : `wikilink://${encodeURIComponent(title)}`
    return `[${text}](${href})`
  })
}

// Extract all wikilinked note titles from content
export function extractWikilinkTitles(content: string): string[] {
  const titles: string[] = []
  const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g
  let match
  while ((match = regex.exec(content)) !== null) {
    titles.push(match[1].trim())
  }
  return titles
}
