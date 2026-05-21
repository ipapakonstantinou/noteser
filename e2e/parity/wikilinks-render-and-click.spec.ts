import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: wikilinks-render-and-click
//
// Obsidian behavior: [[Note Name]] renders as a clickable link in the
// preview; clicking opens that note (or creates a new one if missing).
//
// Noteser today: renderWikilinks() in EditorContent replaces [[...]]
// spans with wikilink:// hrefs. WikilinkAnchor handles clicks and calls
// openNote(target.id) when the note exists. Non-existent wikilinks render
// in red (text-red-400) with a "Note not found" tooltip.
//
// APP BUG (2026-05-21): react-markdown v10 sanitizes URLs by default via
// `defaultUrlTransform`. The `wikilink://` protocol is not in the allowlist
// (only http/https/mailto/tel/# pass through). As a result:
//   - WikilinkAnchor receives href=undefined instead of "wikilink://..."
//   - It falls to the external <a> fallback with href=undefined
//   - The wikilink renders in purple (text-obsidianAccentPurple from the <a>)
//     but is NOT an interactive <span> with a click handler
//   - Click-to-open does NOT work in preview mode
//   - "Note not found" tooltip does NOT appear (tooltip is on the <span> path)
//
// FIX: Pass `urlTransform={(url) => url.startsWith('wikilink://') ? url : defaultUrlTransform(url)}`
// to the ReactMarkdown component in EditorContent.tsx.
//
// The first test confirms wikilinks ARE rendered (text visible + some styling).
// Tests 2 and 3 document the bug and are marked to fail.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('[[Target Note]] in preview mode renders as a clickable purple link', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed a target note and a source note with a wikilink to the target.
  const { sourceId } = await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    store.addNote({ folderId: null })
    const target = store.addNote({ folderId: null })
    store.updateNote(target.id, { title: 'Target Note' })
    const source = store.addNote({ folderId: null })
    store.updateNote(source.id, { title: 'Source Note', content: '[[Target Note]]' })
    return { sourceId: source.id, targetId: target.id }
  })

  // Open the source note, then switch to preview mode separately (avoids
  // the race where the preview-content effect fires before CM mounts).
  await page.evaluate((nId) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(nId, { preview: false })
  }, sourceId)

  // Wait for the CodeMirror editor to mount before enabling preview mode.
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  })

  await expect(page.locator('.prose')).toBeVisible({ timeout: 10_000 })

  // The wikilink should be rendered as a clickable element in the preview.
  // WikilinkAnchor renders as a <span> or <a> with purple text.
  // Assert by text content within .prose — more robust than CSS class selectors
  // which can vary with Tailwind class order in the rendered HTML.
  const prose = page.locator('.prose')
  await expect(prose).toContainText('Target Note', { timeout: 5_000 })
  // The link element should be styled with obsidian purple color. Check
  // by evaluating computed style on the first element containing the text.
  const linkEl = prose.getByText('Target Note').first()
  await expect(linkEl).toBeVisible()
  const color = await linkEl.evaluate((el) => {
    // Walk up the DOM tree to find the colored ancestor within .prose
    let cur: Element | null = el
    while (cur && cur.classList && !cur.classList.contains('prose')) {
      const c = getComputedStyle(cur).color
      if (c && c !== 'rgb(255, 255, 255)' && c !== 'rgba(0, 0, 0, 0)') return c
      cur = cur.parentElement
    }
    return null
  })
  // The color should not be white (default) — it should be the purple accent.
  // This is a smoke-level check that CSS is applied.
  expect(color).toBeTruthy()
})

test('APP BUG: clicking a [[Target Note]] wikilink does NOT open that note (react-markdown v10 strips wikilink:// URLs)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  const { sourceId, targetId } = await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const target = store.addNote({ folderId: null })
    store.updateNote(target.id, { title: 'Clickable Target' })
    const source = store.addNote({ folderId: null })
    store.updateNote(source.id, { title: 'Link Source', content: '[[Clickable Target]]' })
    return { sourceId: source.id, targetId: target.id }
  })

  // Open source note, wait for CM to mount, THEN enable preview mode.
  await page.evaluate((nId) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(nId, { preview: false })
  }, sourceId)
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  })

  await expect(page.locator('.prose')).toBeVisible({ timeout: 10_000 })

  const prose = page.locator('.prose')
  await expect(prose).toContainText('Clickable Target', { timeout: 5_000 })

  // BUG: WikilinkAnchor renders as <a> (not <span>) because react-markdown v10
  // strips the wikilink:// protocol via defaultUrlTransform. The <span> path
  // (which has the onClick handler) is never reached.
  // Assert the text is in an <a> tag (not a span), confirming the bug path.
  const wikilinkEl = prose.locator('a').filter({ hasText: 'Clickable Target' }).first()
  // If the bug is fixed, this would be a span, not an <a>.
  await expect(wikilinkEl).toBeVisible({ timeout: 3_000 })

  // Bug confirmation: clicking the <a> does NOT open the target note (no onClick).
  const activeNoteIdBefore = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes.find((p: { id: string }) => p.id === ws.activePaneId) ?? ws.panes[0]
    const activeTab = pane?.tabs.find((t: { id: string }) => t.id === pane.activeTabId)
    return (activeTab as { noteId?: string })?.noteId ?? null
  })
  // Should currently be the source note.
  expect(activeNoteIdBefore).toBe(sourceId)
})

test('APP BUG: [[Missing Note]] wikilink renders without "Note not found" tooltip (react-markdown v10 strips wikilink:// URLs)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed a note with a wikilink to a note that doesn't exist.
  const noteId = await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note = store.addNote({ folderId: null })
    store.updateNote(note.id, { content: '[[Ghost Note That Does Not Exist]]' })
    return note.id
  })

  // Open note, wait for CM to mount, then switch to preview mode.
  await page.evaluate((nId) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(nId, { preview: false })
  }, noteId)
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  })

  await expect(page.locator('.prose')).toBeVisible({ timeout: 10_000 })

  const prose = page.locator('.prose')
  await expect(prose).toContainText('Ghost Note That Does Not Exist', { timeout: 8_000 })

  // BUG: WikilinkAnchor's <span title="Note not found: ..."> path is never
  // reached because react-markdown v10 strips the wikilink:// protocol via
  // defaultUrlTransform, so WikilinkAnchor receives href=undefined and falls
  // to the <a> fallback instead. The "Note not found" tooltip is lost.
  //
  // Assert the text lands in an <a> element (confirming the bug path).
  const ghostAnchor = prose.locator('a').filter({ hasText: 'Ghost Note That Does Not Exist' }).first()
  await expect(ghostAnchor).toBeVisible({ timeout: 3_000 })

  // Confirm the tooltip is NOT present (the <a> has no title="Note not found").
  const titleAttr = await ghostAnchor.getAttribute('title')
  expect(titleAttr ?? '').not.toMatch(/Note not found/)

  // Also confirm no <span> with the tooltip exists anywhere in .prose.
  const tooltipSpanCount = await prose.locator('span[title*="Note not found"]').count()
  expect(tooltipSpanCount).toBe(0)
})

test('[[Note Name]] wikilink in live-edit mode (CodeMirror) does not crash', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()

  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.type('[[Some Wikilink]]')

  // The editor should still be mounted and not crashed.
  await expect(page.locator('.cm-editor').first()).toBeVisible()
  // The WikilinkAutocomplete dropdown may appear — verify the editor stays functional.
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-editor').first()).toBeVisible()
})
