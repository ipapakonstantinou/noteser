// Scan note bodies for attachment references so the Settings UI can flag
// orphans (attachments that no note links to).
//
// The relevant markdown forms today:
//   - `![alt](attachments/foo.png)`               standard image link
//   - `![alt](attachments/foo.png "title")`       with title (rare, but valid)
//   - `<img src="attachments/foo.png">`           HTML image (Obsidian compat)
//   - `![[Pasted image 20260522.png]]`            Obsidian wiki image embed
//
// The wiki form is the one Obsidian writes when you paste an image: a BARE
// filename with no folder, while the blob is stored under some path (e.g.
// `Files/Pasted image 20260522.png`). Resolving the bare name to its stored
// path requires the path list, so the wiki-aware scan lives behind
// collectReferencedAttachments / findOrphanAttachments which have it.

import type { Note } from '@/types'
import { isAttachmentPath, getAttachmentPrefixes } from './attachments'

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
// `![[target]]` or `![[target|alias]]` — capture the target only.
const WIKI_EMBED_RE = /!\[\[([^\]|\n]+?)(?:\|[^\]\n]+?)?\]\]/g

// Basename (final path segment) lower-cased, for loose filename matching.
function basenameKey(pathOrName: string): string {
  const base = pathOrName.split('/').pop() ?? pathOrName
  return base.trim().toLowerCase()
}

// Every wiki-style image embed target in `content` (bare names, trimmed).
// Only image-extension targets are returned — `![[Some Note]]` transclusions
// are not attachments. Exported for testing.
export function extractWikiImageTargets(content: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  WIKI_EMBED_RE.lastIndex = 0
  while ((m = WIKI_EMBED_RE.exec(content)) !== null) {
    const target = m[1].trim()
    if (IMAGE_EXT_RE.test(target)) out.push(target)
  }
  return out
}

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
//
// `knownPaths` (the stored attachment path list) is optional: when supplied,
// wiki-style image embeds (`![[Pasted image.png]]`) are resolved by basename
// to their stored path and counted as referenced too. Without it, only the
// explicit `![](path)` / `<img>` forms are recognised (back-compat for the
// existing callers / tests that don't pass it).
export function collectReferencedAttachments(
  notes: Note[],
  knownPaths?: Iterable<string>,
): Set<string> {
  const refs = new Set<string>()
  // basename → stored path, for resolving bare wiki-embed names.
  const byBasename = new Map<string, string>()
  if (knownPaths) {
    for (const p of knownPaths) {
      const key = basenameKey(p)
      if (!byBasename.has(key)) byBasename.set(key, p)
    }
  }
  for (const note of notes) {
    if (note.isDeleted) continue
    for (const ref of extractAttachmentRefs(note.content)) refs.add(ref)
    if (byBasename.size > 0) {
      for (const target of extractWikiImageTargets(note.content)) {
        const stored = byBasename.get(basenameKey(target))
        if (stored) refs.add(stored)
      }
    }
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
  // Pass allPaths so wiki-style image embeds resolve to their stored path and
  // stop being mis-flagged as orphans (the Obsidian `![[Pasted image.png]]`
  // case — 164 false orphans before this).
  const referenced = collectReferencedAttachments(notes, allPaths)
  return allPaths.filter(p => isAttachmentPath(p) && !referenced.has(p))
}
