// noteser-importer / parsers.js
//
// Pure transform helpers for the three source formats the plugin
// accepts. Every function in this module is a deterministic mapping
// from input strings/paths to a normalised note record. Side-effect
// free so the unit tests can run in node without touching the worker
// or the vault.
//
// Records returned by the parsers match the v1.2 vault.write contract:
//
//   { title, body, folderPath?, lossy? }
//
// Lossy markers travel up so the plugin can tally them in the final
// summary the user sees after the import completes.

// ─── Obsidian ─────────────────────────────────────────────────────────
//
// Obsidian vaults are folders of `.md` and `.markdown` files with
// wikilinks (`[[Note]]` / `[[Note|alias]]`), `#tags`, and optional YAML
// frontmatter. The format is the closest match to Noteser's own on-disk
// shape, so no body transforms are needed. We pass content through
// verbatim and let the host's createNote serialise it.

// Strip the `.md` / `.markdown` extension and any leading folder path
// segments so the title is just the file basename. The folder
// structure becomes the `folderPath` field instead.
export function parseObsidianEntry(relativePath, content) {
  const { folderPath, baseName } = splitPath(relativePath)
  const title = stripMarkdownExtension(baseName)
  if (!title) return null
  return {
    title,
    body: content,
    ...(folderPath ? { folderPath } : {}),
  }
}

// ─── Notion ───────────────────────────────────────────────────────────
//
// Notion's Markdown export ships a ZIP whose entries look like:
//
//   "My page abcdef0123456789abcdef0123456789.md"
//   "My page abcdef0123456789abcdef0123456789/Child page 0123....md"
//
// The 32-char hex suffix appended to every name is Notion's internal id
// — useless once the page leaves Notion and ugly in a vault. The first
// transform strips it from both file names AND folder segments.
//
// Intra-vault links inside the markdown body look like
// `[Some page](Some%20page%20abcdef....md)` or with the id appended to
// directory-style paths. We rewrite those to `[[Some page]]` wikilinks
// so noteser's existing link layer picks them up.

const NOTION_ID_RE = /\s+[0-9a-f]{32}(?=$|\.md|\.csv|\/)/gi

export function stripNotionIds(s) {
  // Reset lastIndex defensively — `g`-flag regexes are stateful across
  // matches when reused.
  NOTION_ID_RE.lastIndex = 0
  return s.replace(NOTION_ID_RE, '')
}

// Decode percent-encoded path segments (Notion exports URL-encode spaces
// inside markdown links). Falls back to the raw string if decoding
// throws (rare malformed sequences).
function safeDecode(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// Convert Notion-style markdown links that target other markdown files
// in the same export into noteser wikilinks. We DO NOT touch http(s)
// links, anchor-only links, image links, or links to .csv exports
// (those are databases — out of scope for v0.1).
export function convertNotionLinks(body) {
  // `[Label](path/to/page%20abcdef0123456789abcdef0123456789.md)` →
  // `[[Label]]` — Notion's intra-vault links always end in `.md`.
  return body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, label, href) => {
    if (/^https?:\/\//i.test(href)) return whole
    if (href.startsWith('#')) return whole
    if (!/\.md(?:#|\?|$)/i.test(href)) return whole
    // The target's display name is whatever the author wrote inside the
    // square brackets. Notion exports often duplicate the title into the
    // label, so `[Foo](Foo abc...md)` collapses cleanly to `[[Foo]]`.
    const decodedLabel = safeDecode(label)
    return `[[${decodedLabel}]]`
  })
}

export function parseNotionEntry(relativePath, content) {
  const cleanedPath = stripNotionIds(relativePath)
  const { folderPath, baseName } = splitPath(cleanedPath)
  const title = stripMarkdownExtension(baseName)
  if (!title) return null
  const body = convertNotionLinks(content)
  return {
    title,
    body,
    ...(folderPath ? { folderPath } : {}),
  }
}

// ─── Logseq ───────────────────────────────────────────────────────────
//
// Logseq exports a folder of `.md` files plus a `journals/` and `pages/`
// split. Bodies use `[[wikilinks]]` (kept as-is) AND `((block-id))`
// references — UUID lookups into other pages' block trees. Block refs
// have NO portable form outside Logseq, so we degrade them to a literal
// callout-style blockquote and tally the lossy conversion in the
// summary the user sees.

// Logseq block ids are UUIDv4 strings. Match the parens wrapper too.
const LOGSEQ_BLOCK_REF_RE = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi

// Convert a block ref to a literal blockquote so the import is lossless
// in TEXT terms (the user still sees the reference id) but the
// `((...))` syntax noteser does not understand is replaced. Returns
// `{ body, lossy }`.
export function convertLogseqBlockRefs(body) {
  let lossy = 0
  const converted = body.replace(LOGSEQ_BLOCK_REF_RE, (_whole, id) => {
    lossy++
    return `\n> note from Logseq import: block ref ${id}\n`
  })
  return { body: converted, lossy }
}

export function parseLogseqEntry(relativePath, content) {
  const { folderPath, baseName } = splitPath(relativePath)
  const title = stripMarkdownExtension(baseName)
  if (!title) return null
  const { body, lossy } = convertLogseqBlockRefs(content)
  return {
    title,
    body,
    ...(folderPath ? { folderPath } : {}),
    ...(lossy > 0 ? { lossy } : {}),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

// Splits a forward-slash path into a folder path (no trailing slash)
// and the basename. `"a/b/c.md"` → `{ folderPath: "a/b", baseName: "c.md" }`.
// `"top.md"` → `{ folderPath: "", baseName: "top.md" }`.
export function splitPath(relativePath) {
  // Collapse any backslashes to forward slashes; some archive tooling
  // mixes them depending on which OS authored the file.
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const idx = norm.lastIndexOf('/')
  if (idx < 0) return { folderPath: '', baseName: norm }
  return {
    folderPath: norm.slice(0, idx),
    baseName: norm.slice(idx + 1),
  }
}

export function stripMarkdownExtension(name) {
  return name.replace(/\.(md|markdown)$/i, '').trim()
}

// File-name suffix matcher used by both the directory picker and the
// ZIP walker. Case-insensitive; leading-dot optional in the input.
export function hasMarkdownExtension(name) {
  return /\.(md|markdown)$/i.test(name)
}
