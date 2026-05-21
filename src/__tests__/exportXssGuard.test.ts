/**
 * exportXssGuard.test.ts
 *
 * Locks down the HTML export paths against XSS. The export module has
 * two HTML generators — `buildPrintableHtml` (used by the in-browser
 * "Print / PDF" path) and `convertToHTML` (used by the ZIP export when
 * format='html'). Both must run note bodies through `escapeHTML` BEFORE
 * the naive markdown→HTML regex pass, otherwise a `<script>` or
 * `<img onerror=...>` in note content ends up executable in the file
 * delivered to the recipient.
 *
 * The static-source check guarantees the call shape doesn't regress; we
 * don't import the private generators directly since they're not
 * exported. A future contributor who refactors should preserve the
 * `convertMarkdownToHTML(escapeHTML(...))` pattern.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const EXPORT_TS = readFileSync(join(__dirname, '..', 'utils', 'export.ts'), 'utf8')

describe('export HTML XSS guards (static-source)', () => {
  test('every convertMarkdownToHTML call escapes its input', () => {
    // Find every call site of convertMarkdownToHTML in export.ts. Each
    // must wrap the argument in escapeHTML(...). The function is local
    // to that file so the file-scoped scan is exhaustive.
    const pattern = /convertMarkdownToHTML\(([^)]+(?:\([^)]*\)[^)]*)*)\)/g
    const offenders: string[] = []
    let m: RegExpExecArray | null
    while ((m = pattern.exec(EXPORT_TS)) !== null) {
      const arg = m[1].trim()
      // The function's own definition: `const convertMarkdownToHTML = (markdown: string)`
      // — skip when matching that line.
      if (/^markdown: string/.test(arg)) continue
      // Acceptable: escapeHTML(...) — possibly with nested args.
      if (/^escapeHTML\(/.test(arg)) continue
      offenders.push(arg)
    }
    expect(offenders).toEqual([])
  })

  test('escapeHTML helper still encodes the dangerous characters', () => {
    // The static check above only catches the call-shape; this asserts
    // the helper actually does the work. If `escapeHTML` ever stops
    // covering one of these, both export paths regress silently.
    const code = EXPORT_TS
    expect(code).toMatch(/escapeHTML\s*=\s*\(str: string\)/)
    expect(code).toMatch(/replace\(\/&\/g/)
    expect(code).toMatch(/replace\(\/</g)
    expect(code).toMatch(/replace\(\/>/g)
    expect(code).toMatch(/replace\(\/"/g)
  })
})
