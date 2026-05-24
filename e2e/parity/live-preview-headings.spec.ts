import { test, expect } from '@playwright/test'
import { setupCleanVault } from './_helpers'

// Obsidian-parity scenario: live-preview-headings
//
// Obsidian behavior: typing `# heading` on a line styles it as a heading
// (larger font, bold) while the cursor is on that line, and the `#`
// marker is visible while editing. When the cursor leaves the line in
// rendered/preview mode the marker hides; in edit mode the marker
// still shows but the line stays heading-styled.
//
// Noteser today: markdownLivePreview.ts attaches a `cm-lp-h1`
// (h2/h3/h4) class on the CodeMirror line. We assert that class
// appears for `# foo` and that the rendered font-size > base.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('typing # styles the current line as h1; ## as h2; ### as h3', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  // Boot a fresh note via the Alt+N shortcut so we land in the editor.
  await page.getByTestId('folder-tree').click()
  await page.keyboard.press('Alt+n')
  // Notes open in rendered preview by default (notesOpenInPreviewMode =
  // true); the CodeMirror surface only mounts in edit mode, so flip to it.
  await page.keyboard.press('Control+e')
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  // Focus the editor surface and type a multi-level heading sample.
  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.type('# Heading One\n## Heading Two\n### Heading Three\nplain text\n')

  // Each cm-line that starts with `# ` (etc) should have the
  // matching live-preview class.
  await expect(page.locator('.cm-line.cm-lp-h1')).toHaveCount(1)
  await expect(page.locator('.cm-line.cm-lp-h2')).toHaveCount(1)
  await expect(page.locator('.cm-line.cm-lp-h3')).toHaveCount(1)

  // Sanity: the h1 line renders at a larger font-size than a plain
  // line (the base theme sets `font-size: 1.75em`). This is the cheap
  // "did the CSS actually take effect" check.
  const h1Size = await page.locator('.cm-line.cm-lp-h1').first().evaluate(
    (el) => parseFloat(getComputedStyle(el).fontSize),
  )
  // Find a plain line — exclude the heading lines + any task/list classes.
  const plainSize = await page.locator('.cm-line').last().evaluate(
    (el) => parseFloat(getComputedStyle(el).fontSize),
  )
  expect(h1Size).toBeGreaterThan(plainSize)
})

test('removing # demotes the heading styling', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTestId('folder-tree').click()
  await page.keyboard.press('Alt+n')
  await page.keyboard.press('Control+e')
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.type('# Heading')
  await expect(page.locator('.cm-line.cm-lp-h1')).toHaveCount(1)

  // Erase the `# ` prefix by walking the caret to the start of the line.
  await page.keyboard.press('Home')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Delete')

  // The h1 class should now be gone — the line is plain text.
  await expect(page.locator('.cm-line.cm-lp-h1')).toHaveCount(0)
})
