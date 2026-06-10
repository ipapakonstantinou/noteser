/**
 * themeSelectionContrast.test.ts
 *
 * Regression: every built-in theme MUST paint a selection background
 * (`--obsidian-selection`) that's actually visible — both against the
 * editor background (≥ 2:1 luminance contrast, so the rectangle is
 * findable) AND against the editor text (≥ 4.5:1, so the selected
 * glyphs stay readable).
 *
 * Background: half of launch-week testers reported invisible editor
 * selections (blog post, 2026-06-04). The cause was a single
 * `--obsidian-highlight` token doing double duty as "sidebar hover" AND
 * "editor selection" — values tuned for a calm hover bled into the
 * editor and disappeared against the page bg. We split the token: hover
 * stayed on `obsidian-highlight`, the selection moved to
 * `obsidian-selection`. This test pins the contrast floor across every
 * preset so a future palette tweak can't silently re-break the case.
 */

import { THEME_PRESETS, THEME_TOKENS } from '../utils/theme'

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

// WCAG relative luminance + contrast ratio.
function srgbChan(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
function luminance(hex: string): number {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return 0.2126 * srgbChan(r) + 0.7152 * srgbChan(g) + 0.0722 * srgbChan(b)
}
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const SELECTION_VS_BG_MIN = 2.0
const TEXT_VS_SELECTION_MIN = 4.5

// Defaults from globals.css :root — match the values declared there so
// the test of the "default" preset (empty overrides) reads the same
// numbers the browser would.
const DEFAULTS = Object.fromEntries(
  THEME_TOKENS.map(t => [t.cssVar, t.defaultColor]),
) as Record<string, string>

describe('every theme preset has a visible editor selection', () => {
  test('obsidian-selection token is declared in THEME_TOKENS', () => {
    const token = THEME_TOKENS.find(t => t.cssVar === 'obsidian-selection')
    expect(token).toBeTruthy()
    expect(token!.defaultColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  for (const preset of THEME_PRESETS) {
    test(`"${preset.id}" — selection vs background ≥ ${SELECTION_VS_BG_MIN}:1 and text ≥ ${TEXT_VS_SELECTION_MIN}:1`, () => {
      const resolved = { ...DEFAULTS, ...preset.overrides }
      const bg = resolved['obsidian-black']
      const text = resolved['obsidian-text']
      const sel = resolved['obsidian-selection']
      expect(bg).toBeTruthy()
      expect(text).toBeTruthy()
      expect(sel).toBeTruthy()

      const selVsBg = contrast(sel, bg)
      const textVsSel = contrast(text, sel)
      expect(selVsBg).toBeGreaterThanOrEqual(SELECTION_VS_BG_MIN)
      expect(textVsSel).toBeGreaterThanOrEqual(TEXT_VS_SELECTION_MIN)
    })
  }
})

describe('CodeMirrorEditor wires the selection token (not the hover token)', () => {
  const SRC = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'components', 'editor', 'CodeMirrorEditor.tsx'),
    'utf8',
  ) as string

  // Strip line + block comments so the assertions can't match comment
  // text that explains the wiring. Leaves the actual code untouched.
  const CODE = SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line: string) => !line.trim().startsWith('//'))
    .join('\n')

  test('both .cm-selectionBackground rules paint with --obsidian-selection', () => {
    expect(CODE).toMatch(
      /['"]\.cm-selectionBackground['"]\s*:\s*\{\s*backgroundColor:\s*['"]var\(--obsidian-selection/,
    )
    expect(CODE).toMatch(
      /cm-focused\s*>\s*\.cm-scroller\s*>\s*\.cm-selectionLayer\s*\.cm-selectionBackground/,
    )
    const hits = CODE.match(/--obsidian-selection/g) || []
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })

  test('no live code path reads .cm-selectionBackground from --obsidian-highlight', () => {
    expect(CODE).not.toMatch(/cm-selectionBackground[\s\S]{0,200}--obsidian-highlight/)
  })
})

// ── Selection FOREGROUND (bug #38, 2026-06-10) ────────────────────────────
//
// drawSelection() hides only the native selection's *background* — the
// `::selection` text color still applies. Accent-coloured glyphs in the
// live preview (task `[x]` brackets, list markers, #tags, links — all
// hsl(217,88%,50%)) sat at ~1.4:1 against the blue selection layer and
// went invisible when selected. The fix forces the selected-text colour to
// --obsidian-text (≥ 4.5:1 vs selection in every preset, asserted above):
//   1. obsidianTheme carries a `.cm-line::selection` rule for the editor;
//   2. globals.css `::selection` paints the same token pair for every
//      native-selection surface (reading mode, sidebar, inputs). The old
//      rule used `theme('colors.obsidianAccentPurple / 55%')`, which cannot
//      apply alpha to a var()-based colour and silently compiled to SOLID
//      accent blue — accent-on-accent selected text was 1:1 invisible.
describe('selection foreground keeps accent-coloured text readable (bug #38)', () => {
  const fs = require('fs')
  const path = require('path')
  const EDITOR_SRC = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'editor', 'CodeMirrorEditor.tsx'),
    'utf8',
  ) as string
  const EDITOR_CODE = EDITOR_SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line: string) => !line.trim().startsWith('//'))
    .join('\n')
  const GLOBALS_CSS = fs.readFileSync(
    path.join(__dirname, '..', 'styles', 'globals.css'),
    'utf8',
  ) as string
  // Strip CSS comments so assertions match rules, not prose.
  const CSS_CODE = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  test('obsidianTheme recolours selected editor text to --obsidian-text', () => {
    expect(EDITOR_CODE).toMatch(
      /['"]\.cm-line::selection,\s*\.cm-line\s+::selection['"]\s*:\s*\{\s*color:\s*['"]var\(--obsidian-text/,
    )
  })

  test('globals.css ::selection paints --obsidian-selection bg + --obsidian-text fg', () => {
    const m = CSS_CODE.match(/::selection\s*\{([^}]*)\}/)
    expect(m).toBeTruthy()
    const body = m![1]
    expect(body).toMatch(/background-color:\s*var\(--obsidian-selection/)
    expect(body).toMatch(/color:\s*var\(--obsidian-text/)
  })

  test('globals.css ::selection no longer uses the silent-alpha theme() pattern', () => {
    // `theme('colors.X / NN%')` cannot apply alpha to a var()-based colour —
    // it compiles to the SOLID colour. Keep it out of the ::selection rule.
    expect(CSS_CODE).not.toMatch(/::selection\s*\{[^}]*theme\([^)]*\/[^)]*\)/)
  })
})
