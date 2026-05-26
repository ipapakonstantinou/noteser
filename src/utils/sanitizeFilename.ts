// Filename sanitisers — split out from `utils/export.ts` so consumers
// that only need to sanitise a string (EditableText, EditorHeader,
// folderStore) don't drag jszip + file-saver into the main bundle
// through the module-import graph.
//
// relaxed-sanitizer: we strip ONLY what git + cross-platform filesystems
// truly forbid in a path segment, NOT a tight letters/digits whitelist.
// The old aggressive whitelist (`[^\p{L}\p{N} \-_.()]`) removed perfectly
// legal characters like `&`, apostrophes (`'` / `’`), `,`, `!`, `;`, `+`,
// `=`, `@`, `#`, `[`, `]`, `~`. Real Obsidian vaults are full of those
// ("R&D Work", "Jake's project", "Users & groups"), and stripping them made
// the computed push path drift from the actual remote path, so every sync
// renamed the user's files (the churn / data-drift bug).
//
// FORBIDDEN (and only these):
//   - path separators           /  \
//   - Windows-reserved set       :  *  ?  "  <  >  |
//   - ASCII control chars        U+0000–U+001F
// Everything else — including `&`, `'`, `’`, `(`, `)`, `,`, `!`, `;`, `+`,
// `=`, `@`, `#`, `[`, `]`, `~` — is KEPT. Spaces are kept (collapsed to a
// single space); leading/trailing dots are trimmed (Windows hides/forbids
// them); a length cap stays. The rule is idempotent so push/pull round-trip
// to the same path with no re-upload churn.

export const INVALID_FILENAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/gu

// Live-input sanitizer: drops disallowed chars but PRESERVES spaces.
// Use while the user is typing. Stays in sync with the relaxed rule above so
// what the user types is exactly what the push path uses.
export const sanitizeTitleInput = (s: string): string =>
  s.replace(INVALID_FILENAME_CHARS, '')

// Destination-side sanitizer: strips the forbidden chars, collapses runs of
// whitespace to a SINGLE SPACE (spaces are valid in filenames and git paths,
// and Obsidian keeps them, so we do too), trims, and truncates. It is
// idempotent, so the push (notePath/buildFolderPath) and pull
// (ensureFolderPath) sides round-trip to the same path with no re-upload churn.
//
// Dots are PRESERVED — including a leading dot. Obsidian vaults are full of
// dotfile folders (`.obsidian`, `.noteser`, `.trash`); stripping a leading dot
// would mangle those names and re-introduce the very path-drift churn this fix
// removes. We trust the user / remote: a leading or trailing dot is a real,
// git-legal name segment. Use for the actual filename written to disk or
// pushed to git.
export const sanitizeFilename = (name: string): string => {
  return name
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim()
}
