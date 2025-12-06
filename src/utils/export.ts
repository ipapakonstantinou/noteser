import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import type { Note, Folder, Tag, ExportOptions, ImportResult } from '@/types'

// Export a single note as markdown
export const exportNoteAsMarkdown = (note: Note, tags: Tag[]): void => {
  let content = `# ${note.title}\n\n`

  // Add metadata as YAML frontmatter
  const noteTags = tags.filter(t => note.tags.includes(t.id))
  if (noteTags.length > 0) {
    content = `---\ntags: [${noteTags.map(t => t.name).join(', ')}]\ncreated: ${new Date(note.createdAt).toISOString()}\nupdated: ${new Date(note.updatedAt).toISOString()}\n---\n\n` + content
  }

  content += note.content

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const filename = `${sanitizeFilename(note.title)}.md`
  saveAs(blob, filename)
}

// Export a single note as JSON
export const exportNoteAsJSON = (note: Note): void => {
  const data = JSON.stringify(note, null, 2)
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' })
  const filename = `${sanitizeFilename(note.title)}.json`
  saveAs(blob, filename)
}

// Export all notes as a ZIP file
export const exportAllNotes = async (
  notes: Note[],
  folders: Folder[],
  tags: Tag[],
  options: ExportOptions
): Promise<void> => {
  const zip = new JSZip()

  // Create folder structure
  const folderPaths = new Map<string, string>()
  folderPaths.set('', '') // Root folder

  // Build folder paths
  for (const folder of folders.filter(f => !f.isDeleted)) {
    folderPaths.set(folder.id, sanitizeFilename(folder.name))
  }

  // Add notes to zip
  for (const note of notes.filter(n => !n.isDeleted)) {
    const folderPath = note.folderId
      ? (folderPaths.get(note.folderId) || '')
      : ''

    let content: string
    let extension: string

    if (options.format === 'json') {
      const noteData = options.includeMetadata
        ? note
        : { title: note.title, content: note.content }
      content = JSON.stringify(noteData, null, 2)
      extension = 'json'
    } else if (options.format === 'html') {
      content = convertToHTML(note, tags, options.includeTags)
      extension = 'html'
    } else {
      content = convertToMarkdown(note, tags, options)
      extension = 'md'
    }

    const filename = `${sanitizeFilename(note.title)}.${extension}`
    const fullPath = folderPath ? `${folderPath}/${filename}` : filename

    zip.file(fullPath, content)
  }

  // Add metadata file
  if (options.includeMetadata) {
    const metadata = {
      exportDate: new Date().toISOString(),
      totalNotes: notes.filter(n => !n.isDeleted).length,
      totalFolders: folders.filter(f => !f.isDeleted).length,
      folders: folders.filter(f => !f.isDeleted).map(f => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId
      })),
      tags: tags.map(t => ({ id: t.id, name: t.name, color: t.color }))
    }
    zip.file('_metadata.json', JSON.stringify(metadata, null, 2))
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const date = new Date().toISOString().split('T')[0]
  saveAs(blob, `noteser-export-${date}.zip`)
}

// Convert note to markdown with frontmatter
const convertToMarkdown = (
  note: Note,
  tags: Tag[],
  options: ExportOptions
): string => {
  let content = ''

  if (options.includeMetadata || options.includeTags) {
    const noteTags = tags.filter(t => note.tags.includes(t.id))
    const frontmatter: string[] = []

    if (options.includeTags && noteTags.length > 0) {
      frontmatter.push(`tags: [${noteTags.map(t => t.name).join(', ')}]`)
    }

    if (options.includeMetadata) {
      frontmatter.push(`created: ${new Date(note.createdAt).toISOString()}`)
      frontmatter.push(`updated: ${new Date(note.updatedAt).toISOString()}`)
    }

    if (frontmatter.length > 0) {
      content += `---\n${frontmatter.join('\n')}\n---\n\n`
    }
  }

  content += `# ${note.title}\n\n`
  content += note.content

  return content
}

// Convert note to HTML
const convertToHTML = (note: Note, tags: Tag[], includeTags: boolean): string => {
  const noteTags = tags.filter(t => note.tags.includes(t.id))
  const tagsHTML = includeTags && noteTags.length > 0
    ? `<div class="tags">${noteTags.map(t => `<span class="tag" style="background-color: ${t.color}">${t.name}</span>`).join(' ')}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(note.title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
    .tags { margin-bottom: 20px; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; color: white; font-size: 12px; margin-right: 4px; }
    pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; }
    code { background: #f4f4f4; padding: 2px 4px; border-radius: 2px; }
  </style>
</head>
<body>
  <h1>${escapeHTML(note.title)}</h1>
  ${tagsHTML}
  <div class="content">
    ${convertMarkdownToHTML(note.content)}
  </div>
</body>
</html>`
}

// Simple markdown to HTML converter
const convertMarkdownToHTML = (markdown: string): string => {
  return markdown
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>\n')
}

// Import notes from files
export const importNotes = async (
  files: FileList,
  existingNotes: Note[],
  existingFolders: Folder[]
): Promise<ImportResult> => {
  const result: ImportResult = {
    success: true,
    notesImported: 0,
    foldersImported: 0,
    errors: []
  }

  for (const file of Array.from(files)) {
    try {
      if (file.name.endsWith('.zip')) {
        await importFromZip(file, result)
      } else if (file.name.endsWith('.md')) {
        await importMarkdownFile(file, result)
      } else if (file.name.endsWith('.json')) {
        await importJSONFile(file, result)
      } else {
        result.errors.push(`Unsupported file type: ${file.name}`)
      }
    } catch (error) {
      result.errors.push(`Error importing ${file.name}: ${error}`)
    }
  }

  result.success = result.errors.length === 0
  return result
}

// Import from ZIP file
const importFromZip = async (file: File, result: ImportResult): Promise<Note[]> => {
  const zip = await JSZip.loadAsync(file)
  const notes: Note[] = []

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir || path.startsWith('_')) continue

    const content = await zipEntry.async('string')

    if (path.endsWith('.md')) {
      const note = parseMarkdownNote(content, path)
      notes.push(note)
      result.notesImported++
    } else if (path.endsWith('.json') && !path.includes('_metadata')) {
      const note = JSON.parse(content) as Note
      notes.push(note)
      result.notesImported++
    }
  }

  return notes
}

// Import markdown file
const importMarkdownFile = async (file: File, result: ImportResult): Promise<Note> => {
  const content = await file.text()
  const note = parseMarkdownNote(content, file.name)
  result.notesImported++
  return note
}

// Import JSON file
const importJSONFile = async (file: File, result: ImportResult): Promise<Note> => {
  const content = await file.text()
  const note = JSON.parse(content) as Note
  result.notesImported++
  return note
}

// Parse markdown file with frontmatter
const parseMarkdownNote = (content: string, filename: string): Note => {
  let title = filename.replace(/\.md$/, '')
  let noteContent = content
  const tags: string[] = []

  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    noteContent = content.slice(frontmatterMatch[0].length)

    // Extract tags
    const tagsMatch = frontmatter.match(/tags:\s*\[(.*?)\]/)
    if (tagsMatch) {
      tags.push(...tagsMatch[1].split(',').map(t => t.trim()))
    }
  }

  // Extract title from first heading
  const titleMatch = noteContent.match(/^#\s+(.+)$/m)
  if (titleMatch) {
    title = titleMatch[1]
    noteContent = noteContent.replace(/^#\s+.+\n*/, '')
  }

  const now = Date.now()
  return {
    id: `imported-${now}-${Math.random().toString(36).substr(2, 9)}`,
    title,
    content: noteContent.trim(),
    folderId: null,
    tags,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null
  }
}

// Utility: Sanitize filename
const sanitizeFilename = (name: string): string => {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100)
}

// Utility: Escape HTML
const escapeHTML = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
