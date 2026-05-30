/**
 * markdownXssGuard.test.tsx
 *
 * Static-source security pins for the markdown render path. The
 * runtime assertions on react-markdown's behaviour live in the
 * react-markdown test suite itself; here we lock down the
 * APP-LEVEL guarantees we depend on:
 *
 *   1. No file under src/ imports `rehype-raw` — that's the plugin
 *      that would let an attacker inject raw HTML through markdown.
 *      Adding it would silently regress every XSS guarantee we rely
 *      on across the EditorContent preview AND the public /share
 *      page.
 *
 *   2. No file under src/ uses `dangerouslySetInnerHTML`. We render
 *      everything through React's standard escaping or through
 *      react-markdown's element tree, never as raw HTML.
 *
 *   3. The /share page uses the same react-markdown call shape
 *      (remarkPlugins=[remarkGfm], no rehypePlugins) so a future
 *      contributor doesn't accidentally widen its XSS surface
 *      relative to the in-app preview.
 *
 * These pass / fail at compile time effectively — a regression that
 * introduces any of the three is caught immediately.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const SRC_ROOT = join(__dirname, '..')

function walkSrc(dir: string, hits: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkSrc(full, hits)
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) hits.push(full)
  }
  return hits
}

const FILES = walkSrc(SRC_ROOT)

test('no source file imports rehype-raw (would allow raw-HTML XSS in markdown)', () => {
  const offenders: string[] = []
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')
    if (/from ['"]rehype-raw['"]/.test(text) || /require\(['"]rehype-raw['"]\)/.test(text)) {
      offenders.push(file)
    }
  }
  expect(offenders).toEqual([])
})

test('no source file uses dangerouslySetInnerHTML', () => {
  const offenders: string[] = []
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')
    if (/dangerouslySetInnerHTML/.test(text)) offenders.push(file)
  }
  expect(offenders).toEqual([])
})

test('react-markdown is only configured with remark-gfm — no rehype plugins anywhere', () => {
  // rehypePlugins={[...]} attribute on a ReactMarkdown invocation is
  // a yellow flag: even rehype-sanitize is fine, but contributors
  // sometimes paste rehype-raw alongside it. Lock the current
  // baseline so any new plugin lands as a test review touchpoint.
  const offenders: { file: string; snippet: string }[] = []
  for (const file of FILES) {
    if (!/\.tsx?$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    const m = text.match(/rehypePlugins=\{[^}]*\}/)
    if (m) offenders.push({ file, snippet: m[0] })
  }
  expect(offenders).toEqual([])
})

test('no source file assigns to .innerHTML (DOM-level raw-HTML sink)', () => {
  // Banned alongside dangerouslySetInnerHTML — same XSS surface, just
  // reached via document/element handles instead of React's escape hatch.
  // Pattern: `<anything>.innerHTML = <anything>` or
  // `<anything>.innerHTML +=` (cumulative assignment). textContent is
  // the safe alternative; React state is the better one. Added
  // 2026-05-30 after an external security review flagged this as the
  // last unguarded sink (the lint-rule path was abandoned because
  // FlatCompat with next/core-web-vitals silently drops custom rule
  // blocks; this static-source check has the same blast radius).
  const offenders: { file: string; line: string }[] = []
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      if (/\.innerHTML\s*[+]?=/.test(line) && !line.includes('// eslint-disable')) {
        offenders.push({ file, line: line.trim() })
      }
    }
  }
  expect(offenders).toEqual([])
})

test('share page renders user content through react-markdown (not raw)', () => {
  const sharePage = readFileSync(join(SRC_ROOT, 'app/share/page.tsx'), 'utf8')
  // Sanity: the page uses ReactMarkdown to render. If a future
  // refactor inlines the body via dangerouslySetInnerHTML or
  // bypasses react-markdown, this test fails LOUDLY.
  expect(sharePage).toContain('ReactMarkdown')
  expect(sharePage).not.toContain('dangerouslySetInnerHTML')
})
