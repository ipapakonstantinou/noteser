import { test, expect, type Browser, type Page } from '@playwright/test'

// H2: "Stop live" ends the session for everyone, and the old link stays dead.
// Runs against the real worker code (`wrangler dev`, started by
// playwright.config*.ts on 127.0.0.1:8790).

type Sock = { url: string; closed: boolean; frames: number }

async function openPage(browser: Browser, path: string): Promise<{ page: Page; sockets: Sock[] }> {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: {
          onboardingShown: true,
          sidebarGroups: [{ id: 'g-files', tabs: ['files'], activeTab: 'files', collapsed: false }],
        },
        version: 3,
      }))
    } catch { /* ignore */ }
  })
  const sockets: Sock[] = []
  page.on('websocket', ws => {
    const s: Sock = { url: ws.url(), closed: false, frames: 0 }
    sockets.push(s)
    ws.on('framereceived', () => { s.frames++ })
    ws.on('close', () => { s.closed = true })
  })
  const res = await page.goto(path)
  test.skip(!res?.headers()['content-security-policy']?.includes('ws://127.0.0.1:8790'),
    'dev server was started without the e2e NEXT_PUBLIC_YJS_WS_URL (reused server?)')
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)
  return { page, sockets }
}

const roomOf = (link: string) => new URLSearchParams(new URL(link).hash.slice(1)).get('collab')!
const inRoom = (sockets: Sock[], room: string) => sockets.filter(s => s.url.endsWith(`/${room}`))
const copiedLink = async (page: Page) => {
  await page.getByTestId('status-bar-collab-share').click()
  return page.evaluate(() => navigator.clipboard.readText())
}

test('Stop live disconnects everyone, and the old link never sees later edits', async ({ browser }) => {
  test.setTimeout(120_000)
  const A = await openPage(browser, '/')
  const id = await A.page.evaluate(() =>
    window.__noteser_test!.stores.noteStore.getState()
      .addNote({ title: 'Stop test', content: 'before stop' }).id)
  await A.page.evaluate((noteId) => {
    const el = document.querySelector(`[data-testid="note-row"][data-note-id="${noteId}"]`) as HTMLElement
    el.click(); el.click()
  }, id)
  const link1 = await copiedLink(A.page)
  const room1 = roomOf(link1)

  // B joins through the worker and gets A's text.
  const B = await openPage(browser, link1)
  await expect(B.page.locator('.cm-content')).toContainText('before stop')
  await expect(B.page.getByTestId('status-bar-collab-toggle')).toHaveAttribute('aria-pressed', 'true')

  // A stops: B is closed for good, live is off on B, and B is told.
  await A.page.getByTestId('status-bar-collab-toggle').click()
  await expect(B.page.getByText('This live session was ended')).toBeVisible()
  await expect(B.page.getByTestId('status-bar-collab-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => inRoom(B.sockets, room1).every(s => s.closed)).toBe(true)
  await B.page.waitForTimeout(4_000) // > y-websocket's 2.5 s max backoff
  expect(inRoom(B.sockets, room1)).toHaveLength(1)

  // A goes live again: a different link.
  const link2 = await copiedLink(A.page)
  const room2 = roomOf(link2)
  expect(room2).not.toBe(room1)
  await expect.poll(() => inRoom(A.sockets, room2).some(s => s.frames > 0)).toBe(true)

  // The old link in a fresh context: the worker's ended marker accepts and
  // closes it with 4410 at once, so it gets nothing and stops for good.
  const C = await openPage(browser, link1)
  await expect(C.page.getByText('This live session was ended')).toBeVisible()
  await expect.poll(() => inRoom(C.sockets, room1).length > 0 && inRoom(C.sockets, room1).every(s => s.closed)).toBe(true)
  expect(inRoom(C.sockets, room1).every(s => s.frames === 0)).toBe(true)
  // Control: someone on the NEW link does get A's later typing.
  const D = await openPage(browser, link2)
  await expect(D.page.locator('.cm-content')).toContainText('before stop')

  await A.page.locator('.cm-content').click()
  await A.page.keyboard.press('End')
  await A.page.keyboard.type(' AFTER-STOP-7731')
  await expect(D.page.locator('.cm-content')).toContainText('AFTER-STOP-7731')
  await C.page.waitForTimeout(1_500)
  await expect(C.page.locator('.cm-content')).not.toContainText('AFTER-STOP-7731')
  await expect(C.page.locator('.cm-content')).not.toContainText('before stop')
  expect(inRoom(C.sockets, room1)).toHaveLength(1) // never retried
})
