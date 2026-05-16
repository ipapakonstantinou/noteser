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

// Replace [[title]] and [[title|display]] with markdown links for ReactMarkdown
export function renderWikilinks(content: string): string {
  return content.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, title, display) => {
    const text = (display?.trim() || title.trim()).replace(/[[\]]/g, '')
    return `[${text}](wikilink://${encodeURIComponent(title.trim())})`
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
