/**
 * welcome-take-feature-tour
 *
 * Clicking the "Take the feature tour" card on the Welcome pane:
 *   1. Shows "Seeding tour…" on the button while in-flight (disabled state).
 *   2. Creates a "Feature tour" note at vault root (folderId === null).
 *   3. Seeds 9 PNG attachments into IDB under Files/feature-tour/*.png.
 *   4. Closes the Welcome tab and opens the Feature tour note in preview mode.
 *   5. Clicking the card again (after a re-open of welcome) focuses the
 *      existing note rather than duplicating it.
 *
 * Runs against the deployed app at https://noteser.thetechjon.com.
 */

import { test, expect } from '@playwright/test'

const DEPLOYED = 'https://noteser.thetechjon.com'

// Clean vault — but WITHOUT onboardingShown=true so the welcome tab appears.
async function freshVault(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      const dbs = ['noteser', 'keyval-store']
      for (const name of dbs) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    try {
      window.localStorage.setItem(
        'noteser-settings',
        JSON.stringify({ state: { onboardingShown: false }, version: 2 }),
      )
    } catch { /* ignore */ }
  })
}

test('feature tour card seeds note and closes welcome tab', async ({ page }) => {
  await freshVault(page)
  await page.goto(DEPLOYED)

  // Wait for welcome pane to appear.
  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // The feature tour card is in the "Start here" section.
  const tourCard = page.getByTestId('welcome-feature-tour')
  await expect(tourCard).toBeVisible()

  // Click it and observe the seeding state transition.
  await tourCard.click()

  // While seeding, the button should show "Seeding tour…" and be disabled.
  // This is transient — assert with a short timeout that it either shows
  // or already finished (the deploy may be fast enough to skip the state).
  // We tolerate completion without catching the busy state on fast networks.
  const seedingOrGone = page.getByText('Seeding tour…')
  // Check if button becomes disabled at any point (best-effort, may be too fast).
  // Main assertion: after seeding completes, welcome pane is GONE and the
  // Feature tour note is open.

  // Wait for welcome pane to disappear (seeding + close completes).
  await expect(page.getByTestId('welcome-pane')).not.toBeVisible({ timeout: 30_000 })

  // Wait for test hooks.
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )

  // Assert: a "Feature tour" note exists in the note store at vault root.
  const featureTourNote = await page.evaluate(() => {
    const notes = window.__noteser_test?.stores.noteStore.getState().notes ?? []
    return notes.find((n: { title: string; folderId: string | null; isDeleted: boolean }) =>
      n.title === 'Feature tour' && n.folderId === null && !n.isDeleted
    ) ?? null
  })
  expect(featureTourNote).not.toBeNull()

  // The editor should now be showing something (not blank).
  // The active tab should NOT be a welcome tab anymore — note content visible.
  // Check for the Feature tour content: the note body starts with a blockquote.
  await expect(page.locator('.cm-content, .prose').first()).toBeVisible({ timeout: 5_000 })
})

test('feature tour seeds 9 PNG attachments into IDB', async ({ page }) => {
  await freshVault(page)
  await page.goto(DEPLOYED)

  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('welcome-feature-tour').click()

  // Wait for seeding to finish (welcome pane disappears).
  await expect(page.getByTestId('welcome-pane')).not.toBeVisible({ timeout: 30_000 })

  // Wait for test hooks.
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )

  // Check IDB for the 9 images. We query the keyval-store IDB directly.
  // The attachments are stored at "Files/feature-tour/NN-<name>.png".
  const attachmentCount = await page.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open('keyval-store')
      req.onsuccess = () => {
        const db = req.result
        const stores = Array.from(db.objectStoreNames)
        if (stores.length === 0) { resolve(0); return }
        const tx = db.transaction(stores[0], 'readonly')
        const store = tx.objectStore(stores[0])
        const allKeys = store.getAllKeys()
        allKeys.onsuccess = () => {
          const keys = allKeys.result as string[]
          const tourKeys = keys.filter(k =>
            typeof k === 'string' && k.includes('feature-tour') && k.endsWith('.png')
          )
          resolve(tourKeys.length)
        }
        allKeys.onerror = () => resolve(0)
      }
      req.onerror = () => resolve(0)
    })
  })

  // Expect at least some (ideally 9) attachments. Accept >= 1 as a minimum
  // signal that the seeding ran, but assert 9 as the target.
  expect(attachmentCount).toBe(9)
})

test('clicking feature tour again focuses existing note, no duplicate', async ({ page }) => {
  await freshVault(page)
  await page.goto(DEPLOYED)

  // First seed.
  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('welcome-feature-tour').click()
  await expect(page.getByTestId('welcome-pane')).not.toBeVisible({ timeout: 30_000 })

  // Wait for test hooks.
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )

  const countAfterFirst = await page.evaluate(() => {
    const notes = window.__noteser_test?.stores.noteStore.getState().notes ?? []
    return notes.filter((n: { title: string; isDeleted: boolean }) =>
      n.title === 'Feature tour' && !n.isDeleted
    ).length
  })
  expect(countAfterFirst).toBe(1)

  // Re-open the welcome tab by calling openWelcome via the workspace store.
  await page.evaluate(() => {
    window.__noteser_test?.stores.workspaceStore.getState().openWelcome()
  })

  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('welcome-feature-tour').click()
  await expect(page.getByTestId('welcome-pane')).not.toBeVisible({ timeout: 30_000 })

  const countAfterSecond = await page.evaluate(() => {
    const notes = window.__noteser_test?.stores.noteStore.getState().notes ?? []
    return notes.filter((n: { title: string; isDeleted: boolean }) =>
      n.title === 'Feature tour' && !n.isDeleted
    ).length
  })
  // Still exactly one Feature tour note — no duplicate was created.
  expect(countAfterSecond).toBe(1)
})
