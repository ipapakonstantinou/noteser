// Filename sanitisers — split out from `utils/export.ts` so consumers
// that only need to sanitise a string (EditableText, EditorHeader,
// folderStore) don't drag jszip + file-saver into the main bundle
// through the module-import graph.
//
// Whitelist: Unicode letter (\p{L}) + Unicode digit (\p{N}) + space +
// `- _ . ( )`. Anything else is stripped — keeps titles safe across
// Windows, macOS, Linux, URLs, and git paths.

export const INVALID_FILENAME_CHARS = /[^\p{L}\p{N} \-_.()]/gu

// Live-input sanitizer: drops disallowed chars but PRESERVES spaces.
// Use while the user is typing.
export const sanitizeTitleInput = (s: string): string =>
  s.replace(INVALID_FILENAME_CHARS, '')

// Destination-side sanitizer: strips disallowed chars, collapses runs of
// whitespace to a SINGLE SPACE (spaces are valid in filenames and git paths,
// and Obsidian keeps them, so we do too), trims, and truncates. It is
// idempotent, so the push (notePath/buildFolderPath) and pull
// (ensureFolderPath) sides round-trip to the same path with no re-upload
// churn. Use for the actual filename written to disk or pushed to git.
export const sanitizeFilename = (name: string): string => {
  return name
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim()
}
