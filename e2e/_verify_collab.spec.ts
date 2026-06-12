import { test, expect, type Page } from '@playwright/test'

// Manual verification for the collab duplication + probe fixes. Underscore-
// prefixed so it stays OUT of the default CI suite (it needs the real
// collab.noteser.app worker reachable + NEXT_PUBLIC_YJS_WS_URL set on the dev
// server). Run explicitly (rename off the `_` prefix or point the runner at
// it directly):
//   NEXT_PUBLIC_YJS_WS_URL=wss://collab.noteser.app/<token> npm run dev   (separate shell)
//   npx playwright test e2e/<renamed>.spec.ts

const SENTINEL = 'ZQX-UNIQUE-BODY-7731'
const BODY = `# Collab heading\nfirst body line ${SENTINEL}\nsecond body line`

// Shape of the testHooks bridge this spec touches. Cast inline (rather than
// augmenting the global Window) so it never collides with the canonical
// declaration in src/utils/testHooks.ts under tsc.
type Hooks = {
  stores: {
    noteStore: { getState(): {
      addNote: (i: { title: string; content: string }) => { id: string }
      notes: Array<{ id: string; collabId?: string; content: string }>
    } }
    workspaceStore: { getState(): { openNote: (id: string, o: { preview: boolean }) => void } }
  }
}
// NOTE: page.evaluate callbacks run in the BROWSER, so they cast `window`
// inline rather than closing over any Node-side helper.

async function waitForHooks(page: Page) {
  await page.waitForFunction(
    () => typeof (window as unknown as { __noteser_test?: unknown }).__noteser_test !== 'undefined',
    undefined, { timeout: 20_000 },
  )
}

function trackErrors(page: Page): string[] {
  const errs: string[] = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push(String(e)))
  return errs
}

const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

test('collab: pill connected, body once, live A→B sync, single saved content', async ({ browser }) => {
  // ── Context A — seeder ────────────────────────────────────────────────────
  const ctxA = await browser.newContext()
  const pageA = await ctxA.newPage()
  const errA = trackErrors(pageA)
  await pageA.goto('/')
  await waitForHooks(pageA)

  const noteId = await pageA.evaluate((content) => {
    const h = (window as unknown as { __noteser_test: Hooks }).__noteser_test
    const n = h.stores.noteStore.getState().addNote({ title: 'Collab Note', content })
    h.stores.workspaceStore.getState().openNote(n.id, { preview: false })
    return n.id
  }, BODY)

  // Editor must show the body (seeded into the fresh room over the wire) and
  // exactly once — the doubling bug rendered it twice.
  await expect(pageA.locator('.cm-content').first()).toContainText(SENTINEL, { timeout: 20_000 })
  const aText = await pageA.locator('.cm-content').first().innerText()
  expect(countOccurrences(aText, SENTINEL)).toBe(1)

  // Pill must report connected ("Live: on") — the probe now dials /<token>/<room>.
  await expect(pageA.getByTestId('status-bar-collab')).toHaveText(/Live: on/, { timeout: 20_000 })

  // The note's stable collabId (room) is minted when the binding attaches.
  await pageA.waitForFunction(
    (id) => !!(window as unknown as { __noteser_test: Hooks }).__noteser_test
      .stores.noteStore.getState().notes.find(n => n.id === id)?.collabId,
    noteId, { timeout: 20_000 },
  )
  const collabId = await pageA.evaluate(
    (id) => (window as unknown as { __noteser_test: Hooks }).__noteser_test
      .stores.noteStore.getState().notes.find(n => n.id === id)!.collabId!,
    noteId,
  )

  // Saved content must be the SINGLE body, never doubled.
  const storedA = await pageA.evaluate(
    (id) => (window as unknown as { __noteser_test: Hooks }).__noteser_test
      .stores.noteStore.getState().notes.find(n => n.id === id)!.content,
    noteId,
  )
  expect(countOccurrences(storedA, SENTINEL)).toBe(1)

  // ── Context B — joiner via share link ─────────────────────────────────────
  const ctxB = await browser.newContext()
  const pageB = await ctxB.newPage()
  const errB = trackErrors(pageB)
  await pageB.goto(`/?collab=${collabId}&title=Collab%20Note`)
  await waitForHooks(pageB)

  // B materialises an EMPTY local note bound to the room and pulls A's content
  // over the wire — exactly once.
  await expect(pageB.locator('.cm-content').first()).toContainText(SENTINEL, { timeout: 20_000 })
  const bText = await pageB.locator('.cm-content').first().innerText()
  expect(countOccurrences(bText, SENTINEL)).toBe(1)
  await expect(pageB.getByTestId('status-bar-collab')).toHaveText(/Live: on/, { timeout: 20_000 })

  // ── Live sync A → B ───────────────────────────────────────────────────────
  const liveToken = 'LIVE-EDIT-FROM-A-4477'
  await pageA.locator('.cm-content').first().click()
  await pageA.keyboard.press('Control+End')
  await pageA.keyboard.type(`\n${liveToken}`)
  await expect(pageB.locator('.cm-content').first()).toContainText(liveToken, { timeout: 20_000 })

  // ── No CSP / WebSocket errors on either client ────────────────────────────
  const offending = [...errA, ...errB].filter(e => /content security policy|csp|websocket|wss:/i.test(e))
  expect(offending, `offending console errors:\n${offending.join('\n')}`).toEqual([])

  await ctxA.close()
  await ctxB.close()
})
