import { test, expect, type Page } from '@playwright/test'
import { encodeShareLink } from '../src/utils/shareLink'

// The /share "Import to my vault" hand-off must keep the note in the URL
// fragment: a query string reaches the host's request logs (and the RSC
// fetch of the navigation carries it). Old `/?import=` links keep working.

test.beforeEach(async ({ page }) => {
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
  page.on('dialog', d => void d.accept())
})

const frag = encodeShareLink('Imported note', 'imported body', 'http://localhost:3001').split('#')[1]

async function imported(page: Page): Promise<boolean> {
  return page.evaluate(() => !!window.__noteser_test?.stores?.noteStore?.getState().notes
    .some(n => n.title === 'Imported note' && n.content === 'imported body'))
}

test('Import from /share travels in the fragment and lands the note', async ({ page }) => {
  const urls: string[] = []
  page.on('request', r => urls.push(r.url()))
  await page.goto(`/share#${frag}`)
  const cta = page.getByTestId('share-import-cta')
  await expect(cta).toHaveAttribute('href', /^\/#import=/)
  await cta.click()
  await expect.poll(() => imported(page)).toBe(true)
  await expect.poll(() => page.evaluate(() => location.pathname + location.search + location.hash)).toBe('/')
  expect(urls.filter(u => new URL(u).searchParams.has('import'))).toEqual([])
})

test('a legacy /?import= link still imports', async ({ page }) => {
  await page.goto(`/?import=${encodeURIComponent(frag)}`)
  await expect.poll(() => imported(page)).toBe(true)
})
