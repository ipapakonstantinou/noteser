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
import { ATTACHMENT_DIR, isAttachmentPath } from './attachments'

// One regex per surface form. Anchored on the `attachments/` prefix so we
// don't accidentally match external URLs or other paths.
const MD_IMG_RE = new RegExp(`!\\[[^\\]]*\\]\\((${ATTACHMENT_DIR}/[^)\\s]+)`, 'g')
const HTML_IMG_RE = new RegExp(`<img[^>]+src=["'](${ATTACHMENT_DIR}/[^"']+)["']`, 'gi')

// Return every distinct attachment path referenced by the given content.
export function extractAttachmentRefs(content: string): string[] {
  const refs = new Set<string>()
  let m: RegExpExecArray | null
  MD_IMG_RE.lastIndex = 0
  while ((m = MD_IMG_RE.exec(content)) !== null) refs.add(m[1])
  HTML_IMG_RE.lastIndex = 0
  while ((m = HTML_IMG_RE.exec(content)) !== null) refs.add(m[1])
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

// Given the IDB path list and the active notes, return paths that no note
// references. Defensive: anything not under attachments/ is excluded from
// the input set, so we never flag unrelated keys.
export function findOrphanAttachments(allPaths: string[], notes: Note[]): string[] {
  const referenced = collectReferencedAttachments(notes)
  return allPaths.filter(p => isAttachmentPath(p) && !referenced.has(p))
}
