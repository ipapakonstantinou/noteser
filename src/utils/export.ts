import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import { extractTags } from './tags'
import {
  INVALID_FILENAME_CHARS,
  sanitizeTitleInput,
  sanitizeFilename,
} from './sanitizeFilename'
import type { Note, Folder, Tag, ExportOptions, ImportResult } from '@/types'

// Export a single note as markdown
// `tags` is accepted for backwards compatibility but no longer used —
// derived from #word patterns in the body now.
export const exportNoteAsMarkdown = (note: Note, _tags: Tag[] = []): void => {
  let content = `# ${note.title}\n\n`

  // Add metadata as YAML frontmatter when the note has any inline tags.
  const noteTags = extractTags(note.content)
  if (noteTags.length > 0) {
    content = `---\ntags: [${noteTags.join(', ')}]\ncreated: ${new Date(note.createdAt).toISOString()}\nupdated: ${new Date(note.updatedAt).toISOString()}\n---\n\n` + content
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
  _tags: Tag[],
  options: ExportOptions
): string => {
  let content = ''

  if (options.includeMetadata || options.includeTags) {
    const noteTags = extractTags(note.content)
    const frontmatter: string[] = []

    if (options.includeTags && noteTags.length > 0) {
      frontmatter.push(`tags: [${noteTags.join(', ')}]`)
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

// Build a printable HTML document for one or many notes. Each note is
// rendered as its own section with a CSS page-break so the system
// print dialog produces a clean per-note PDF. No new dependency —
// the browser's print-to-PDF does the work.
//
// Exported so the ExportModal can hand the output to openPrintWindow.
// Pure (no side effects) so tests can assert against the markup.
export const buildPrintableHtml = (
  notes: Note[],
  includeTags: boolean,
  docTitle: string,
): string => {
  const sections = notes.map((n, idx) => {
    const noteTags = extractTags(n.content)
    const tagsHtml = includeTags && noteTags.length > 0
      ? `<div class="tags">${noteTags.map(t => `<span class="tag">#${escapeHTML(t)}</span>`).join(' ')}</div>`
      : ''
    // page-break-before on every section EXCEPT the first so a single-
    // note export doesn't print a blank leading page.
    const breakClass = idx === 0 ? '' : ' class="page-break"'
    return `<section${breakClass}>
  <h1>${escapeHTML(n.title || '(untitled)')}</h1>
  ${tagsHtml}
  <div class="content">
    ${convertMarkdownToHTML(escapeHTML(n.content))}
  </div>
</section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHTML(docTitle)}</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-break { page-break-before: always; }
    }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; line-height: 1.6; color: #222; }
    h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
    h2 { margin-top: 1.5em; }
    .tags { margin-bottom: 16px; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; background: #eef; color: #335; font-size: 12px; margin-right: 4px; }
    pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; }
    code { background: #f4f4f4; padding: 2px 4px; border-radius: 2px; }
    section + section { margin-top: 2em; }
  </style>
</head>
<body>
  ${sections}
</body>
</html>`
}

// Side-effecting: spawn a new window, write the HTML, fire print().
// Returns the window handle so callers can close/test it; null if the
// browser blocked the popup. Kept separate from buildPrintableHtml so
// the pure helper is unit-testable in jsdom (which doesn't print).
export const openPrintWindow = (html: string): Window | null => {
  if (typeof window === 'undefined') return null
  const w = window.open('', '_blank', 'noopener,noreferrer')
  if (!w) {
    // Popup blocker. We surface a user-visible alert here rather than
    // failing silently — there's no other obvious recovery.
    if (typeof window !== 'undefined') {
      window.alert('Pop-up blocked. Please allow pop-ups for this site to export as PDF.')
    }
    return null
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  // Give the new document a tick to lay out before we trigger the
  // print dialog — some browsers race otherwise and print a blank.
  w.onload = () => {
    try { w.focus(); w.print() } catch { /* ignore */ }
  }
  return w
}

// Single-note PDF export. Builds a printable HTML doc and opens the
// system print dialog (which lets the user "Save as PDF").
export const exportNoteAsPdf = (note: Note): void => {
  const html = buildPrintableHtml([note], true, note.title || 'Note')
  openPrintWindow(html)
}

// All-notes PDF export — concatenates active notes into one printable
// doc with page breaks between them.
export const exportAllNotesAsPdf = (
  notes: Note[],
  options: ExportOptions,
): void => {
  const active = notes.filter(n => !n.isDeleted)
  const date = new Date().toISOString().split('T')[0]
  const html = buildPrintableHtml(active, options.includeTags, `Noteser export ${date}`)
  openPrintWindow(html)
}

// Single-note HTML export — previously only reachable via the all-notes
// zip path; surfacing it here so the modal's "Current Note + HTML"
// combination produces an HTML file instead of silently downgrading
// to markdown.
export const exportNoteAsHTML = (note: Note, includeTags = true): void => {
  const html = buildPrintableHtml([note], includeTags, note.title || 'Note')
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  saveAs(blob, `${sanitizeFilename(note.title)}.html`)
}

// Convert note to HTML
const convertToHTML = (note: Note, _tags: Tag[], includeTags: boolean): string => {
  const noteTags = extractTags(note.content)
  const tagsHTML = includeTags && noteTags.length > 0
    ? `<div class="tags">${noteTags.map(t => `<span class="tag">#${escapeHTML(t)}</span>`).join(' ')}</div>`
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
    ${convertMarkdownToHTML(escapeHTML(note.content))}
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
  // Tags from frontmatter are inlined as #tag at the top of the body so
  // they survive in the new derived-tags model.
  const tagPrefix = tags.length > 0 ? tags.map(t => `#${t}`).join(' ') + '\n\n' : ''
  return {
    id: `imported-${now}-${Math.random().toString(36).substr(2, 9)}`,
    title,
    content: tagPrefix + noteContent.trim(),
    folderId: null,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null
  }
}

// Sanitisers moved to `./sanitizeFilename` so light consumers
// (EditableText, EditorHeader, folderStore) don't drag jszip +
// file-saver into the main bundle via the import graph. Re-exported
// here for backward compatibility — old callers keep working.
//
// Re-import not just re-export so other functions in this file can
// continue to call `sanitizeFilename()` directly.
export { INVALID_FILENAME_CHARS, sanitizeTitleInput, sanitizeFilename }

// Utility: Escape HTML
const escapeHTML = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
