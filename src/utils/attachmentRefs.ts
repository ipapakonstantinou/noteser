// Scan note bodies for attachment references so the Settings UI can flag
// orphans (attachments that no note links to).
//
// The relevant markdown forms today:
//   - `![alt](attachments/foo.png)`               standard image link
//   - `![alt](attachments/foo.png "title")`       with title (rare, but valid)
//   - `<img src="attachments/foo.png">`           HTML image (Obsidian compat)
//
// We don't bother with wiki-style `![[attachments/foo.png]]` — noteser doesn't
// emit that form yet. Adding it later is a one-regex edit here.

import type { Note } from '@/types'
import { isAttachmentPath, getAttachmentPrefixes } from './attachments'

// Regex-escape a literal string so it can be embedded in a RegExp.
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Return every distinct attachment path referenced by the given content.
// Builds the regexes per call so a settings change (new attachments folder)
// is reflected immediately. Always recognises the historical default
// `attachments/` plus the configured folder.
export function extractAttachmentRefs(content: string): string[] {
  const refs = new Set<string>()
  for (const prefix of getAttachmentPrefixes()) {
    const escaped = escapeForRegex(prefix)
    const mdRe = new RegExp(`!\\[[^\\]]*\\]\\((${escaped}[^)\\s]+)`, 'g')
    const htmlRe = new RegExp(`<img[^>]+src=["'](${escaped}[^"']+)["']`, 'gi')
    let m: RegExpExecArray | null
    while ((m = mdRe.exec(content)) !== null) refs.add(m[1])
    while ((m = htmlRe.exec(content)) !== null) refs.add(m[1])
  }
  return [...refs]
}

// Union of all attachment refs across every non-deleted note.
export function collectReferencedAttachments(notes: Note[]): Set<string> {
  const refs = new Set<string>()
  for (const note of notes) {
    if (note.isDeleted) continue
    for (const ref of extractAttachmentRefs(note.content)) refs.add(ref)
  }
  return refs
}

// Rewrite every occurrence of `oldPath` in `content` to `newPath`. Used when
// an attachment is moved between folders so the markdown refs in notes stay
// pointing at the file's new location.
export function rewriteAttachmentRefs(
  content: string,
  oldPath: string,
  newPath: string,
): string {
  if (oldPath === newPath || !content.includes(oldPath)) return content
  const escaped = escapeForRegex(oldPath)
  return content.replace(new RegExp(escaped, 'g'), newPath)
}

// Given the IDB path list and the active notes, return paths that no note
// references. Defensive: anything not under attachments/ is excluded from
// the input set, so we never flag unrelated keys.
export function findOrphanAttachments(allPaths: string[], notes: Note[]): string[] {
  const referenced = collectReferencedAttachments(notes)
  return allPaths.filter(p => isAttachmentPath(p) && !referenced.has(p))
}
