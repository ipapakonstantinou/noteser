// Shared helpers used by both the pull (syncPull.ts) and push (syncPush.ts)
// halves of the sync pipeline. This module is the post-split home for the
// path-computation, note-serialization, parser, and vault-encryption helpers
// that previously lived at the top of the monolithic githubSync.ts.
//
// External callers should NOT import from this file directly — they should
// continue to import from `@/utils/githubSync`, which is a thin barrel that
// re-exports the public surface. Internal modules under `githubSync/` import
// from here directly.

import type { Note, Folder } from '@/types'
// Import from the dedicated sanitiser module, NOT from '../export'. The
// latter statically imports jszip + file-saver at module scope, and
// githubSync sits on the app-init path (useGitHubSync → useAutoSync), so
// importing sanitizeFilename from '../export' dragged jszip + file-saver
// into the first-load bundle. '../sanitizeFilename' is jszip-free.
import { sanitizeFilename } from '../sanitizeFilename'
import { encryptNoteContent, decryptNoteContent, isEncryptedContent } from '../vaultCrypto'
import { getVaultKey, VaultLockedError } from '../vaultKey'

// Encrypt note body for push, if the vault is unlocked AND encryption
// is enabled at the settings layer. Returns the original content when
// encryption is off — keeps the call sites tidy and ensures push works
// in the default (unencrypted) configuration.
export async function maybeEncryptForPush(content: string): Promise<string> {
  let enabled = false
  try {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    enabled = useSettingsStore.getState().vaultEncryptionEnabled
  } catch {
    // Test envs without the store — treat as disabled.
  }
  if (!enabled) return content
  const key = getVaultKey()
  if (!key) {
    // Encryption is on but the user hasn't unlocked. Bail with a typed
    // error the UI can catch to prompt for the passphrase.
    throw new VaultLockedError('Push aborted — vault is encrypted but locked. Unlock to continue.')
  }
  return await encryptNoteContent(content, key)
}

// Decrypt remote note content on pull. Pass-through when the content
// isn't an encrypted envelope. Throws VaultLockedError when an
// envelope is present but the user hasn't unlocked yet — caller catches.
export async function maybeDecryptFromPull(content: string): Promise<string> {
  if (!isEncryptedContent(content)) return content
  const key = getVaultKey()
  if (!key) {
    throw new VaultLockedError('Pull skipped — remote blob is encrypted but vault is locked.')
  }
  return await decryptNoteContent(content, key)
}

// ── Path computation ────────────────────────────────────────────────────────
// Mirrors the local folder hierarchy. Notes with folderId=null go at the
// repo root. The .md filename is derived from the note title.

export function buildFolderPath(folderId: string | null, folders: Folder[]): string {
  if (!folderId) return ''
  const byId = new Map(folders.map(f => [f.id, f]))
  const segs: string[] = []
  let cur: Folder | undefined = byId.get(folderId)
  // Walk up to root; guard against cycles with a depth cap.
  for (let i = 0; cur && i < 32; i++) {
    if (cur.isDeleted) break
    segs.unshift(sanitizeFilename(cur.name))
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return segs.join('/')
}

// Repo-paths (e.g. `.obsidian/themes`) for every non-deleted local folder.
// Used by the pull's directory-walking pass to skip dirs we already
// materialised — without it we'd emit duplicate folderCreated entries on
// every sync.
export function collectLocalFolderRepoPaths(folders: Folder[]): Set<string> {
  const out = new Set<string>()
  for (const f of folders) {
    if (f.isDeleted) continue
    const p = buildFolderPath(f.id, folders)
    if (p) out.add(p)
  }
  return out
}

export function notePath(note: Note, folders: Folder[]): string {
  const dir = buildFolderPath(note.folderId, folders)
  const file = `${sanitizeFilename(note.title || 'Untitled')}.md`
  return dir ? `${dir}/${file}` : file
}

// preserve-gitpath-on-push (the sanitizer-churn fix): the destination path a
// PUSH writes a note to.
//
// THE CHURN BUG: on clone a note's gitPath is set to the REAL remote path
// (e.g. "R&D Work.md"). On push we used to ALWAYS re-derive the path from the
// title via notePath(), which runs the title back through sanitizeFilename.
// The old aggressive sanitizer stripped git-legal characters (`&`, `'`, `:`,
// …), so the recomputed path ("RD Work.md") no longer matched the stored
// gitPath ("R&D Work.md"). The push then deleted the real file + created a
// stripped-name copy — rename churn on EVERY sync, permanently mangling the
// user's filenames. (The relaxed sanitizer in sanitizeFilename.ts is the other
// half of the fix; together they stop the drift.)
//
// THE RULE:
//   * NEW note (gitPath null/empty — never synced): derive a fresh path from
//     the title via notePath() (relaxed sanitizer). It has no remote path yet.
//   * SYNCED note whose title + folder STILL derive to its stored gitPath:
//     use the stored gitPath VERBATIM. This is the no-churn path — even if any
//     residual sanitizer difference existed, the cloned note stays pinned to
//     the exact path the remote already has, so a freshly-cloned vault pushes
//     nothing.
//   * SYNCED note whose derived path DIFFERS from gitPath: the user genuinely
//     RENAMED the title or MOVED the folder (updateNote/moveNoteToFolder change
//     title/folderId but NOT gitPath — propagation is the push's job). We
//     return the freshly-derived path so the move reaches the remote; the
//     deletion loop (step 4) sha:null's the old gitPath. NOT breaking this is
//     why we re-derive instead of blindly trusting gitPath.
//
// Folder names feed the derived path through buildFolderPath (also relaxed), so
// the same principle covers folder-name churn: a synced note under a folder
// like "Users & groups" derives back to its stored gitPath → no churn; a real
// folder rename/move derives a new path → propagates.
export function pushPath(note: Note, folders: Folder[]): string {
  if (!note.gitPath) return notePath(note, folders)
  // Synced note: trust the stored path unless a genuine rename/move means the
  // derived path no longer matches it.
  const derived = notePath(note, folders)
  return derived === note.gitPath ? note.gitPath : derived
}

// Map common image extensions to MIME types so attachment pulls hand the
// apply layer a properly-typed Blob. Unknown extensions fall back to
// `application/octet-stream` — the file still round-trips, just without a
// recognised type for browser previews.
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

export function guessMimeFromPath(path: string): string {
  const dotIdx = path.lastIndexOf('.')
  if (dotIdx === -1) return 'application/octet-stream'
  const ext = path.slice(dotIdx + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

// ── Note serialization ──────────────────────────────────────────────────────
// We write the body verbatim — no YAML frontmatter. Tags now live as `#word`
// patterns inline in the body, so there's nothing to round-trip in a header.
// Round-trip identity uses the file path (Phase 4 pull matches by gitPath).
//
// IMPORTANT: we normalise to LF line endings + a single trailing newline so
// our blob SHA matches what Obsidian (and most editors that follow the POSIX
// "text files end in \n" convention) write for the same logical content. Without
// this, every Obsidian-side save would re-touch the file and noteser would see
// the trailing-newline difference as drift, re-uploading every blob on each
// sync (the storm bug). See `normalizeForPush` for the canonical form.
export function serializeNote(note: Note): string {
  return normalizeForPush(note.content ?? '')
}

// Canonical wire form: CRLF → LF, ensure exactly one trailing \n, drop a
// completely empty file's "newline" (an empty file is just empty bytes —
// adding "\n" would create drift the other way).
export function normalizeForPush(content: string): string {
  if (content === '') return ''
  const lf = content.replace(/\r\n/g, '\n')
  return lf.endsWith('\n') ? lf : `${lf}\n`
}

// content-normalization-churn: "did the user actually edit this note since the
// last sync?" — decided by a BYTE-EXACT comparison of the two bodies AFTER
// canonicalisation, NOT by diffing blob SHAs.
//
// The blob-SHA path catches NORMALIZATION DRIFT: a note's stored body and the
// exact remote blob it was pulled from can differ purely by line endings
// (CRLF↔LF) or a trailing newline — never by anything the user typed. Hashing
// the two raw forms yields different SHAs, so a SHA-only "changed?" test reports
// a phantom edit and re-pushes a note the user never touched (the churn). Real
// repro: a smart-punctuation note ("Don’t…" — U+2019/U+2014/U+2009/U+00A0) with
// NO trailing newline whose baseline is the RAW (non-canonical) remote SHA —
// e.g. a legacy note synced before gitLastPushedSha was pinned to the canonical
// form, or a conflict-resolved note pinned to the raw remote SHA.
//
// Canonicalising BOTH sides (normalizeForPush) collapses exactly that drift —
// CRLF→LF and trailing-newline — while preserving every byte the user can type,
// INCLUDING all smart punctuation (curly quotes, em dashes, thin/non-breaking
// spaces survive verbatim). So this returns true iff the only difference between
// the two bodies is normalization → the note is UNEDITED.
export function isUnchangedModuloNormalization(localContent: string, remoteContent: string): boolean {
  return normalizeForPush(localContent) === normalizeForPush(remoteContent)
}

// ── Parser (Phase 4 pull) ───────────────────────────────────────────────────
// We only support the YAML subset we ourselves emit / commonly see in
// Obsidian vaults: `tags: [a, "b", c]` or `aliases: [Short, "Even Shorter"]`
// on a single line. Anything else in the frontmatter is preserved into the
// body so we don't silently destroy custom user metadata.
export interface ParsedNote {
  tags: string[]
  aliases: string[]
  body: string
}

// Parse a single-line YAML inline-array field (e.g. `tags: [a, "b", c]`) out
// of the given frontmatter block. Returns [] when the field is absent or the
// list is empty. Splits on commas, but ignores commas inside double quotes —
// good enough for the formats we produce or encounter in real Obsidian vaults.
function parseInlineArrayField(fmBlock: string, fieldName: string): string[] {
  const re = new RegExp(`^${fieldName}:\\s*\\[(.*)\\]\\s*$`, 'm')
  const lineMatch = fmBlock.match(re)
  if (!lineMatch) return []
  const inner = lineMatch[1].trim()
  if (!inner) return []
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '"') { inQuote = !inQuote; continue }
    if (c === ',' && !inQuote) {
      const t = cur.trim()
      if (t) out.push(t)
      cur = ''
      continue
    }
    cur += c
  }
  const t = cur.trim()
  if (t) out.push(t)
  return out
}

export function parseNote(raw: string): ParsedNote {
  // No frontmatter — everything is body.
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { tags: [], aliases: [], body: raw }
  }
  // Find the closing delimiter starting at line 1.
  const endMatch = raw.match(/\n---\r?\n/)
  if (!endMatch || endMatch.index === undefined) return { tags: [], aliases: [], body: raw }

  const fmBlock = raw.slice(4, endMatch.index)
  const bodyStart = endMatch.index + endMatch[0].length
  const body = raw.slice(bodyStart)

  const tags = parseInlineArrayField(fmBlock, 'tags')
  const aliases = parseInlineArrayField(fmBlock, 'aliases')
  return { tags, aliases, body }
}

// ── Common sync return shapes ───────────────────────────────────────────────

export interface SyncResult {
  unchanged: boolean
  created: number
  updated: number
  deleted: number
  commitSha: string
  commitUrl: string | null
}
