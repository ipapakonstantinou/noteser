/**
 * codeMirrorDrawSelection.test.ts
 *
 * Static-source regression check: `drawSelection()` MUST be imported and
 * applied inside CodeMirrorEditor.tsx.
 *
 * Background: the editor's selection background is painted by CodeMirror's
 * `drawSelection()` plugin into a `.cm-selectionBackground` layer; our
 * obsidianTheme (`backgroundColor: var(--obsidian-highlight)`) styles that
 * layer. Without the plugin, the editor falls back to the native `::selection`
 * pseudo-element on contenteditable. On past builds this combination produced
 * a near-invisible selection — same near-white text on the default light
 * background that CodeMirror's built-in theme paints.
 *
 * The fix made `drawSelection()` explicit in the extensions array (no longer
 * relying on @uiw/react-codemirror's basicSetup defaults). This test pins the
 * arrangement so a future contributor refactoring the extensions list cannot
 * silently drop it again. We test at the source-text level rather than mount
 * a CodeMirror view because jsdom does not faithfully render the
 * `.cm-selectionLayer` (no useful runtime assertion is possible without a
 * real browser).
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const FILE = join(__dirname, '..', 'components', 'editor', 'CodeMirrorEditor.tsx')
const SRC = readFileSync(FILE, 'utf8')

describe('CodeMirrorEditor drawSelection wiring', () => {
  test('imports drawSelection from @codemirror/view', () => {
    // Match any named-import list from @codemirror/view that contains drawSelection.
    const importMatch = SRC.match(
      /import\s*\{[^}]*\bdrawSelection\b[^}]*\}\s*from\s*['"]@codemirror\/view['"]/,
    )
    expect(importMatch).not.toBeNull()
  })

  test('applies drawSelection() inside the extensions array', () => {
    // Call form — drawSelection() must be invoked (not just imported) so its
    // Extension lands in the array. Allow whitespace inside the parens.
    expect(SRC).toMatch(/drawSelection\s*\(\s*\)/)
  })
})
