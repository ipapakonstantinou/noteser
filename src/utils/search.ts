import Fuse, { type IFuseOptions } from 'fuse.js'
import type { Note, SearchResult } from '@/types'

// Configure Fuse.js for fuzzy search
const fuseOptions: IFuseOptions<Note> = {
  keys: [
    { name: 'title', weight: 0.7 },
    { name: 'content', weight: 0.3 },
    { name: 'tags', weight: 0.2 }
  ],
  threshold: 0.4,
  ignoreLocation: true,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  useExtendedSearch: true
}

let fuseInstance: Fuse<Note> | null = null
let lastNotesHash = ''

// Create a hash of notes to detect changes
const hashNotes = (notes: Note[]): string => {
  return notes.map(n => `${n.id}:${n.updatedAt}`).join(',')
}

// Initialize or update the Fuse index
export const initializeSearch = (notes: Note[]): void => {
  const currentHash = hashNotes(notes)
  if (currentHash !== lastNotesHash || !fuseInstance) {
    fuseInstance = new Fuse(notes, fuseOptions)
    lastNotesHash = currentHash
  }
}

// Perform search
export const searchNotes = (
  notes: Note[],
  query: string
): SearchResult[] => {
  if (!query.trim()) return []

  initializeSearch(notes)

  if (!fuseInstance) return []

  const results = fuseInstance.search(query)

  return results.map(result => ({
    noteId: result.item.id,
    title: result.item.title,
    content: result.item.content,
    matches: result.matches || [],
    score: result.score || 0
  }))
}

// Highlight matching text
export const highlightMatches = (
  text: string,
  matches: readonly [number, number][]
): string => {
  if (!matches || matches.length === 0) return text

  let result = ''
  let lastIndex = 0

  // Sort matches by start index
  const sortedMatches = [...matches].sort((a, b) => a[0] - b[0])

  for (const [start, end] of sortedMatches) {
    // Add text before match
    result += text.slice(lastIndex, start)
    // Add highlighted match
    result += `<mark>${text.slice(start, end + 1)}</mark>`
    lastIndex = end + 1
  }

  // Add remaining text
  result += text.slice(lastIndex)

  return result
}

// Get snippet around match
export const getMatchSnippet = (
  content: string,
  matches: readonly { indices: readonly [number, number][]; key?: string }[],
  maxLength = 150
): string => {
  const contentMatch = matches.find(m => m.key === 'content')
  if (!contentMatch || !contentMatch.indices.length) {
    // Return beginning of content
    return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '')
  }

  const [start] = contentMatch.indices[0]
  const snippetStart = Math.max(0, start - 50)
  const snippetEnd = Math.min(content.length, snippetStart + maxLength)

  let snippet = content.slice(snippetStart, snippetEnd)

  if (snippetStart > 0) snippet = '...' + snippet
  if (snippetEnd < content.length) snippet += '...'

  return snippet
}
