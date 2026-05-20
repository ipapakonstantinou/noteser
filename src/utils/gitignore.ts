// Minimal .gitignore matcher (gi9n).
//
// Supports the subset of gitignore syntax that's actually useful for a
// vault: line comments, blank lines, negation with `!`, trailing-slash
// directory-only patterns, leading-slash anchored-to-root patterns, `*`
// (any non-/ chars), `**` (any chars including /), `?` (single non-/
// char). No character classes, no glob-relative-to-current-position
// nuance. Patterns are evaluated in order; later patterns can override
// earlier ones (standard gitignore semantics).
//
// The matcher is built once per sync and reused across both pull and
// push so a path doesn't get filtered inconsistently between the two
// sides of a single round trip.

interface CompiledPattern {
  // Used when the path either is NOT dir-only OR is dir-only with
  // isDir=true. Matches the dir itself (`build`) AND children
  // (`build/x.js`).
  re: RegExp
  // Only set when dirOnly. Used for FILE paths (isDir=false): matches
  // strictly children (`build/x.js`) and refuses to match a file
  // named `build`. gitignore rule: `build/` does NOT match a file
  // called `build`, only directories.
  reChildOnly?: RegExp
  negate: boolean
  dirOnly: boolean
}

// Parse a single line into a CompiledPattern, or null if the line is a
// blank / comment.
export function compilePattern(line: string): CompiledPattern | null {
  let pat = line
  // Strip trailing whitespace (gitignore ignores trailing spaces unless
  // escaped; we don't support the escape syntax — out of scope).
  pat = pat.replace(/\s+$/u, '')
  if (pat === '' || pat.startsWith('#')) return null

  let negate = false
  if (pat.startsWith('!')) {
    negate = true
    pat = pat.slice(1)
  }

  let dirOnly = false
  if (pat.endsWith('/')) {
    dirOnly = true
    pat = pat.slice(0, -1)
  }

  // Leading-slash means "anchored to root" — pattern matches starting
  // at the repo root only. Without a leading slash + without any
  // internal slash, the pattern is "any name at any depth"; with an
  // internal slash, it's anchored to root.
  let anchored = false
  if (pat.startsWith('/')) {
    anchored = true
    pat = pat.slice(1)
  } else if (pat.includes('/')) {
    anchored = true
  }

  // Convert the glob to a regex. `**/` is handled specially so it
  // matches zero or more leading path segments — without that
  // `drafts/**/*.md` wouldn't match `drafts/a.md` (depth 0).
  let body = ''
  let i = 0
  while (i < pat.length) {
    // `**/` → optional any-depth prefix `(?:.*/)?`
    if (pat[i] === '*' && pat[i + 1] === '*' && pat[i + 2] === '/') {
      body += '(?:.*/)?'
      i += 3
      continue
    }
    // `/**` at end → match anything including nothing in this dir
    if (pat[i] === '/' && pat[i + 1] === '*' && pat[i + 2] === '*' && i + 3 === pat.length) {
      body += '(?:/.*)?'
      i += 3
      continue
    }
    // Bare `**` (not adjacent to /) → any chars including /
    if (pat[i] === '*' && pat[i + 1] === '*') {
      body += '.*'
      i += 2
      continue
    }
    const c = pat[i]
    if (c === '*') { body += '[^/]*'; i++; continue }
    if (c === '?') { body += '[^/]';  i++; continue }
    if ('\\.+^$()|{}[]'.includes(c)) { body += '\\' + c; i++; continue }
    body += c
    i++
  }

  // Anchored patterns match starting at index 0; unanchored match any
  // path segment via a `(?:^|.*/)` prefix.
  const prefix = anchored ? '^' : '^(?:|.*/)'
  const suffixBoth   = '(?:$|/.*)' // matches the entry itself OR children
  const suffixChild  = '/.+'        // matches strictly children
  const re = new RegExp(prefix + body + suffixBoth)
  const reChildOnly = dirOnly ? new RegExp(prefix + body + suffixChild) : undefined

  return { re, reChildOnly, negate, dirOnly }
}

export interface GitignoreMatcher {
  // True iff `path` is currently ignored under the compiled rules.
  // `isDir`: pass true when asking about a directory so dir-only
  // patterns can match. For file paths pass false.
  isIgnored: (path: string, isDir?: boolean) => boolean
  // True iff there are any rules at all (so callers can fast-skip).
  isEmpty: () => boolean
}

const EMPTY_MATCHER: GitignoreMatcher = {
  isIgnored: () => false,
  isEmpty: () => true,
}

// Compile a list of gitignore lines into a matcher. Lines are
// processed in order; later patterns can negate earlier matches.
export function compileGitignore(lines: string[]): GitignoreMatcher {
  const patterns: CompiledPattern[] = []
  for (const line of lines) {
    const compiled = compilePattern(line)
    if (compiled) patterns.push(compiled)
  }
  if (patterns.length === 0) return EMPTY_MATCHER

  return {
    isEmpty: () => false,
    isIgnored: (path, isDir = false) => {
      // gitignore semantics: walk all patterns; the LAST match wins.
      // Negations only flip "ignored" off — they can't ignore
      // something that was never matched.
      let ignored = false
      for (const p of patterns) {
        // For dir-only patterns, FILE paths must match the
        // child-only regex (so `build/` matches `build/x.js` but NOT
        // a file literally named `build`). Directory queries use the
        // main regex.
        const re = (p.dirOnly && !isDir) ? p.reChildOnly! : p.re
        if (!re.test(path)) continue
        ignored = !p.negate
      }
      return ignored
    },
  }
}

// Parse the raw text of a .gitignore file into a matcher. CRLF
// tolerant; comments and blanks are filtered by compileGitignore.
export function parseGitignore(raw: string): GitignoreMatcher {
  return compileGitignore(raw.replace(/\r\n/g, '\n').split('\n'))
}

// Default patterns applied when the vault has NO .gitignore at root.
// Kept small and uncontroversial — OS junk + editor backups.
export const DEFAULT_IGNORE_LINES = [
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
  '*.swp',
]

export const DEFAULT_MATCHER: GitignoreMatcher = compileGitignore(DEFAULT_IGNORE_LINES)

// Standard repo location for the gitignore file.
export const GITIGNORE_PATH = '.gitignore'
