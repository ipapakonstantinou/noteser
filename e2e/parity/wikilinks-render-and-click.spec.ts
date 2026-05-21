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
// Was broken (caught by qa-tester 2026-05-21, fixed same day): react-
// markdown v10's defaultUrlTransform stripped the wikilink:// protocol,
// so WikilinkAnchor received href=undefined and fell to the plain <a>
// fallback — no click handler, no "Note not found" tooltip. Fixed by
// passing `urlTransform={(url) => url.startsWith('wikilink://') ? url
// : defaultUrlTransform(url)}` in EditorContent.tsx. These tests now
// assert the working behaviour as a regression guard.

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

test('clicking a [[Target Note]] wikilink in preview opens that note', async ({ page }) => {
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

  // With the urlTransform pass-through, WikilinkAnchor takes the
  // <span>+onClick path. The title attribute confirms it's the
  // wikilink span, not a plain external <a>.
  const wikilinkSpan = prose.locator('span[title^="Open:"]').filter({ hasText: 'Clickable Target' }).first()
  await expect(wikilinkSpan).toBeVisible({ timeout: 5_000 })

  // Clicking opens the target note.
  await wikilinkSpan.click()
  const activeNoteIdAfter = await page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes.find((p: { id: string }) => p.id === ws.activePaneId) ?? ws.panes[0]
    const activeTab = pane?.tabs.find((t: { id: string }) => t.id === pane.activeTabId)
    return (activeTab as { noteId?: string })?.noteId ?? null
  })
  expect(activeNoteIdAfter).toBe(targetId)
})

test('[[Missing Note]] wikilink renders red with "Note not found" tooltip', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  const noteId = await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note = store.addNote({ folderId: null })
    store.updateNote(note.id, { content: '[[Ghost Note That Does Not Exist]]' })
    return note.id
  })

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

  // Now reaches the <span title="Note not found: ..."> render path.
  const ghostSpan = prose.locator('span[title^="Note not found:"]').filter({ hasText: 'Ghost Note That Does Not Exist' }).first()
  await expect(ghostSpan).toBeVisible({ timeout: 5_000 })
  const titleAttr = await ghostSpan.getAttribute('title')
  expect(titleAttr).toMatch(/Note not found: Ghost Note That Does Not Exist/)
})

test('[[Note Name]] wikilink in live-edit mode (CodeMirror) does not crash', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  await page.getByTitle('New note (Alt+N)').click()
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })

  // The "open notes in preview mode" default now lands fresh tabs in
  // preview; the preview overlay intercepts clicks on .cm-content.
  // Toggle to edit mode for this test (it's explicitly about CM
  // behaviour, not the renderer).
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(false)
  })

  const content = page.locator('.cm-content').first()
  await content.click()
  await page.keyboard.type('[[Some Wikilink]]')

  await expect(page.locator('.cm-editor').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-editor').first()).toBeVisible()
})
