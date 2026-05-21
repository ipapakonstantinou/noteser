import { test, expect } from '@playwright/test'

// Scenario: feature-tour-images-render
//
// Seed the Feature tour note (via the welcome-tab button click OR via
// seedFeatureTourNote). Then verify:
//   1. The rendered preview shows ≥9 <img> elements with blob: URLs.
//      (Each image path `Files/feature-tour/X.png` gets resolved by
//       AttachmentImage → IndexedDB → object URL.)
//
// Target: https://noteser.thetechjon.com (deployed app, absolute URLs)
//
// Note: seedFeatureTourNote is NOT on window.__noteser_test — it's a utility
// exported from featureTourNote.ts and called by WelcomePane. We drive the
// Welcome tab button instead, which is the actual user path.

const APP_URL = 'https://noteser.thetechjon.com'

async function waitForHooks(page: import('@playwright/test').Page, timeout = 20_000) {
  await page.waitForFunction(
    () => typeof window.__noteser_test !== 'undefined',
    undefined,
    { timeout },
  )
}

function addCleanSlateScript(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Do NOT set onboardingShown — a fresh vault should show the welcome tab.
    // The test will interact with it.
  })
}

test('feature tour renders ≥9 blob images in preview', async ({ page }) => {
  await addCleanSlateScript(page)
  await page.goto(APP_URL)

  // Wait for the app to mount — the welcome pane should appear on a fresh vault.
  await waitForHooks(page)

  // The welcome pane should be visible (onboarding not shown yet).
  await expect(page.getByTestId('welcome-pane')).toBeVisible({ timeout: 15_000 })

  // Click the "Take the feature tour" button.
  await page.getByTestId('welcome-feature-tour').click()

  // Button shows "Seeding tour…" while busy — wait until it's done.
  // The button is replaced by the note content being shown. We wait for
  // the welcome pane to disappear (the note tab opens, welcome tab is
  // implicitly in the background / still there but note is focused).
  // Instead, wait until the feature tour note appears in the note store.
  await page.waitForFunction(
    () => {
      const notes = window.__noteser_test?.stores.noteStore.getState().notes ?? []
      return notes.some((n: { title: string; isDeleted: boolean }) =>
        n.title === 'Feature tour' && !n.isDeleted,
      )
    },
    undefined,
    { timeout: 30_000 },
  )

  // Give the seed a moment to finish fetching all images (9 PNG fetches).
  // The seedFeatureTourNote() awaits the image downloads before openNote(),
  // so once the store has the note the images should already be in IDB.
  // Still give a short grace period for React rendering.
  await page.waitForTimeout(1_000)

  // The workspace should now have the feature tour note open.
  // Switch to preview mode so the rendered output appears.
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  })
  // Wait a tick for React to re-render.
  await page.waitForTimeout(300)

  // Count <img> elements inside the rendered preview (.prose container).
  // AttachmentImage resolves IDB blobs to blob: object URLs.
  const imgCount = await page.evaluate(() => {
    const prose = document.querySelector('.prose')
    if (!prose) return 0
    return prose.querySelectorAll('img').length
  })

  // There should be at least 9 images (one per tutorial screenshot).
  expect(imgCount).toBeGreaterThanOrEqual(9)

  // Additionally verify that the src attributes use blob: URLs (IDB resolved).
  const blobImgCount = await page.evaluate(() => {
    const prose = document.querySelector('.prose')
    if (!prose) return 0
    return Array.from(prose.querySelectorAll('img')).filter(
      (img) => (img as HTMLImageElement).src.startsWith('blob:'),
    ).length
  })
  expect(blobImgCount).toBeGreaterThanOrEqual(9)
})
