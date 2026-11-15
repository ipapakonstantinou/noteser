import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'

// The live-collab Share link must put BOTH ends in the room from the default
// collaborationMode 'off'. Before the fix neither side dialed it, so the
// recipient got an empty note that never synced. The dev server gets a dummy
// NEXT_PUBLIC_YJS_WS_URL (playwright.config*.ts); we only check what is dialed.

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

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
  })
})

// Opens `path` and returns the URLs of every WebSocket the page creates.
async function openRecordingSockets(page: Page, path: string): Promise<string[]> {
  const sockets: string[] = []
  page.on('websocket', ws => sockets.push(ws.url()))
  const res = await page.goto(path)
  test.skip(!res?.headers()['content-security-policy']?.includes('ws://127.0.0.1:9'),
    'dev server was started without the e2e NEXT_PUBLIC_YJS_WS_URL (reused server?)')
  await page.waitForFunction(() => !!window.__noteser_test?.stores?.noteStore)
  return sockets
}

test('Share puts the sharer in the room', async ({ page }) => {
  const sockets = await openRecordingSockets(page, '/')
  const id = await page.evaluate(() =>
    window.__noteser_test!.stores.noteStore.getState()
      .addNote({ title: 'Shared', content: 'hello', folderId: null }).id)
  await page.evaluate((noteId) => {
    const el = document.querySelector(`[data-testid="note-row"][data-note-id="${noteId}"]`) as HTMLElement
    el.click(); el.click()
  }, id)

  await page.getByTestId('status-bar-collab-share').click()
  const room = await page.evaluate((noteId) =>
    window.__noteser_test!.stores.noteStore.getState().notes.find(n => n.id === noteId)!.collabId!, id)
  await expect.poll(() => sockets.some(u => u.endsWith(`/${room}`))).toBe(true)
  // M3: the copied link carries the room id in the fragment only.
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(new URL(link).search).toBe('')
  expect(new URL(link).hash).toBe(`#collab=${room}&title=Shared`)
})

for (const [kind, path] of [
  ['fragment', (room: string) => `/#collab=${room}&title=Joined`],
  ['legacy query', (room: string) => `/?collab=${room}&title=Joined`],
] as const) {
  test(`opening a ${kind} share link puts the recipient in the room`, async ({ page }) => {
    const room = randomUUID()
    const sockets = await openRecordingSockets(page, path(room))
    await expect.poll(() => sockets.some(u => u.endsWith(`/${room}`))).toBe(true)
    await expect.poll(() => page.evaluate(() => location.search + location.hash)).toBe('')
  })
}

test('a share link pasted into an open tab (fragment-only change) joins', async ({ page }) => {
  const room = randomUUID()
  const sockets = await openRecordingSockets(page, '/')
  await page.evaluate(r => { location.hash = `collab=${r}` }, room)
  await expect.poll(() => sockets.some(u => u.endsWith(`/${room}`))).toBe(true)
})
