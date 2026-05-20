/**
 * gitignore.test.ts
 *
 * Property tests for the lightweight gitignore matcher (gi9n).
 * Covers the subset we actually support: literal names, *, **, ?,
 * leading-slash anchored patterns, trailing-slash dir-only, negation,
 * comments + blanks.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import {
  compileGitignore,
  parseGitignore,
  DEFAULT_MATCHER,
  DEFAULT_IGNORE_LINES,
} from '../utils/gitignore'

function m(...lines: string[]) {
  return compileGitignore(lines)
}

test('blank + comment lines are ignored', () => {
  const matcher = m('', '   ', '# this is a comment', 'foo.md')
  expect(matcher.isIgnored('foo.md')).toBe(true)
  expect(matcher.isIgnored('# this is a comment')).toBe(false)
})

test('literal name matches at any depth (no slash in pattern)', () => {
  const matcher = m('secret.md')
  expect(matcher.isIgnored('secret.md')).toBe(true)
  expect(matcher.isIgnored('notes/secret.md')).toBe(true)
  expect(matcher.isIgnored('a/b/c/secret.md')).toBe(true)
  expect(matcher.isIgnored('not-secret.md')).toBe(false)
})

test('* matches any non-slash chars', () => {
  const matcher = m('*.tmp')
  expect(matcher.isIgnored('foo.tmp')).toBe(true)
  expect(matcher.isIgnored('notes/foo.tmp')).toBe(true)
  expect(matcher.isIgnored('foo.tmp.md')).toBe(false)
  expect(matcher.isIgnored('foo/bar.tmp')).toBe(true)
})

test('? matches a single non-slash char', () => {
  const matcher = m('file?.md')
  expect(matcher.isIgnored('file1.md')).toBe(true)
  expect(matcher.isIgnored('fileA.md')).toBe(true)
  expect(matcher.isIgnored('file.md')).toBe(false)
  expect(matcher.isIgnored('file12.md')).toBe(false)
})

test('** matches any chars including /', () => {
  const matcher = m('drafts/**/*.md')
  expect(matcher.isIgnored('drafts/a.md')).toBe(true)
  expect(matcher.isIgnored('drafts/2026/a.md')).toBe(true)
  expect(matcher.isIgnored('drafts/2026/05/a.md')).toBe(true)
  expect(matcher.isIgnored('public/a.md')).toBe(false)
})

test('leading-slash anchors to repo root', () => {
  const matcher = m('/build')
  expect(matcher.isIgnored('build')).toBe(true)
  expect(matcher.isIgnored('build/x.js')).toBe(true)
  // A nested "build" elsewhere should NOT match because we're anchored.
  expect(matcher.isIgnored('app/build')).toBe(false)
  expect(matcher.isIgnored('app/build/x.js')).toBe(false)
})

test('pattern with internal slash is anchored', () => {
  const matcher = m('notes/private')
  expect(matcher.isIgnored('notes/private')).toBe(true)
  expect(matcher.isIgnored('notes/private/a.md')).toBe(true)
  expect(matcher.isIgnored('other/notes/private')).toBe(false)
})

test('trailing-slash patterns are directory-only', () => {
  const matcher = m('build/')
  // Tested as a directory → match
  expect(matcher.isIgnored('build', true)).toBe(true)
  // Tested as a FILE named `build` → must NOT match (gitignore: build/
  // doesn't match a file).
  expect(matcher.isIgnored('build', false)).toBe(false)
  // Files inside the dir DO propagate the ignore.
  expect(matcher.isIgnored('build/out.js', false)).toBe(true)
  expect(matcher.isIgnored('build/sub/foo.js', false)).toBe(true)
})

test('negation un-ignores a previously-matched path', () => {
  const matcher = m('*.tmp', '!keep.tmp')
  expect(matcher.isIgnored('a.tmp')).toBe(true)
  expect(matcher.isIgnored('keep.tmp')).toBe(false)
  // The negation only applies to its own match — unrelated paths
  // still follow the first rule.
  expect(matcher.isIgnored('b.tmp')).toBe(true)
})

test('order matters: later patterns override earlier', () => {
  // First exclude everything, then re-include one
  const matcher = m('*', '!README.md')
  expect(matcher.isIgnored('foo.md')).toBe(true)
  expect(matcher.isIgnored('README.md')).toBe(false)
})

test('isEmpty fast-path for trivial matchers', () => {
  expect(m().isEmpty()).toBe(true)
  expect(m('# only comments').isEmpty()).toBe(true)
  expect(m('foo').isEmpty()).toBe(false)
})

test('parseGitignore handles CRLF + blank lines', () => {
  const raw = '# header\r\n*.tmp\r\n\r\n!keep.tmp\r\n'
  const matcher = parseGitignore(raw)
  expect(matcher.isIgnored('foo.tmp')).toBe(true)
  expect(matcher.isIgnored('keep.tmp')).toBe(false)
})

test('DEFAULT_MATCHER covers the baked-in OS-junk patterns', () => {
  expect(DEFAULT_MATCHER.isIgnored('.DS_Store')).toBe(true)
  expect(DEFAULT_MATCHER.isIgnored('subdir/.DS_Store')).toBe(true)
  expect(DEFAULT_MATCHER.isIgnored('Thumbs.db')).toBe(true)
  expect(DEFAULT_MATCHER.isIgnored('foo.tmp')).toBe(true)
  expect(DEFAULT_MATCHER.isIgnored('bar.swp')).toBe(true)
  // Sanity: a regular note isn't accidentally swept up.
  expect(DEFAULT_MATCHER.isIgnored('Notes/foo.md')).toBe(false)
  // The list as exposed matches what we test against.
  expect(DEFAULT_IGNORE_LINES).toContain('.DS_Store')
})

test('regex metachars in literal segments are escaped', () => {
  // `a.b` shouldn't be treated as "a" then ANY char then "b".
  const matcher = m('a.b')
  expect(matcher.isIgnored('a.b')).toBe(true)
  expect(matcher.isIgnored('aXb')).toBe(false)
})
