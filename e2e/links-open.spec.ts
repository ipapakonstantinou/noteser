import { test, expect, type Page } from '@playwright/test'

// Live-preview links must open on a real click, in a real browser.
//
// jsdom cannot catch this class of break: PR #302 moved the open from
// mousedown to mouseup and its jsdom test kept a stale reference to the link
// element, so it stayed green while every markdown link on beta went dead.
// Here Chromium does the press and the release itself.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try { for (const n of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(n) } catch { /* ignore */ }
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: {
          onboardingShown: true,
          sidebarGroups: [{ id: 'g-files', tabs: ['files'], activeTab: 'files', collapsed: false }],
        },
        version: 3,
      }))
    } catch { /* ignore */ }
    // Record window.open instead of actually opening a tab.
    ;(window as unknown as { __opened: string[] }).__opened = []
    window.open = ((url?: string | URL) => {
      ;(window as unknown as { __opened: string[] }).__opened.push(String(url))
      return null
    }) as typeof window.open
  })
})

async function opened(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
}

test('markdown link, bare URL and wikilink all open on a real click', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)

  const id = await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    ns.addNote({ title: 'Target', content: 'target body', folderId: null })
    return ns.addNote({
      title: 'Links',
      content: 'md [Example](https://example.com/md) end\n\nbare https://example.com/bare end\n\nwiki [[Target]] end\n',
      folderId: null,
    }).id
  })
  await page.evaluate((noteId) => {
    const el = document.querySelector(`[data-testid="note-row"][data-note-id="${noteId}"]`) as HTMLElement
    el.click(); el.click()
  }, id)

  await expect(page.locator('.cm-lp-link').first()).toBeVisible()

  // 1. markdown link
  await page.locator('.cm-lp-link[data-cm-lp-href="https://example.com/md"]').click()
  await page.waitForTimeout(150)
  expect(await opened(page)).toContain('https://example.com/md')

  // 2. bare URL
  await page.locator('.cm-lp-link[data-cm-lp-href="https://example.com/bare"]').click()
  await page.waitForTimeout(150)
  expect(await opened(page)).toContain('https://example.com/bare')

  // 3. wikilink
  await page.locator('.cm-lp-wikilink').click()
  await page.waitForTimeout(300)
  const tab = await page.locator('.border-t-obsidianAccentPurple span.truncate').first().textContent()
  expect(tab).toContain('Target')
})

test('drag starting on a markdown link selects, does not navigate (#300)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)
  const id = await page.evaluate(() => window.__noteser_test!.stores.noteStore.getState()
    .addNote({ title: 'Links2', content: 'md [Example](https://example.com/md) trailing text here\n', folderId: null }).id)
  await page.evaluate((noteId) => {
    const el = document.querySelector(`[data-testid="note-row"][data-note-id="${noteId}"]`) as HTMLElement
    el.click(); el.click()
  }, id)
  const link = page.locator('.cm-lp-link[data-cm-lp-href="https://example.com/md"]')
  await expect(link).toBeVisible()
  const box = (await link.boundingBox())!
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(await opened(page)).toHaveLength(0)
  expect(sel.length).toBeGreaterThan(0)
})
