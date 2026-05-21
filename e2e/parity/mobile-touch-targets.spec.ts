// Mobile parity: touch-friendly hit targets.
//
// At ≤768px, the primary interactive elements (ribbon nav, tab close X,
// editor header pin/preview buttons) are sized so a finger can hit them
// without zooming. Apple HIG calls for ≥44×44pt; we aim for ≥44px on the
// dominant axis and a generous tap area on the secondary axis.
//
// Asserts at 375×667:
//   - Ribbon buttons (top + bottom) ≥ 44×44.
//   - Editor-header pin + preview buttons ≥ 44×44.
//   - Tab strip height ≥ 44px (the close X hitbox sits inside this).

import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

test.use({ viewport: { width: 375, height: 667 } })

test('ribbon buttons are ≥44×44 on mobile', async ({ page }) => {
  await setupCleanVault(page)
  await page.goto('/')
  await waitForTestHooks(page)
  await page.waitForTimeout(400) // let viewport-driven auto-collapse settle

  // Inspect every <button> inside the Ribbon (.h-full.w-\[44px\] is the ribbon).
  const sizes = await page.evaluate(() => {
    const ribbon = document.querySelector('.h-full.w-\\[44px\\]') as HTMLElement | null
    if (!ribbon) return [] as Array<{ w: number; h: number; title: string }>
    return Array.from(ribbon.querySelectorAll('button')).map((b) => {
      const r = b.getBoundingClientRect()
      return { w: r.width, h: r.height, title: b.getAttribute('title') ?? '' }
    })
  })
  expect(sizes.length).toBeGreaterThan(0)
  for (const s of sizes) {
    expect.soft(s.w, `ribbon button "${s.title}" width`).toBeGreaterThanOrEqual(44)
    expect.soft(s.h, `ribbon button "${s.title}" height`).toBeGreaterThanOrEqual(44)
  }
})

test('editor header pin + preview buttons are ≥44×44 on mobile', async ({ page }) => {
  await setupCleanVault(page)
  await page.goto('/')
  await waitForTestHooks(page)

  // Open a note so the editor header renders.
  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const note = ns.addNote({ title: 'Mobile probe', folderId: null, content: '' })
    window.__noteser_test!.stores.workspaceStore.getState().openNote(note.id, { preview: false })
  })
  await page.waitForTimeout(200)

  const sizes = await page.evaluate(() => {
    const buttons: Array<{ w: number; h: number; title: string }> = []
    for (const sel of ['[title="Pin note"]', '[title="Unpin note"]', '[title="Preview mode"]', '[title="Edit mode"]']) {
      const b = document.querySelector(sel) as HTMLElement | null
      if (!b) continue
      const r = b.getBoundingClientRect()
      buttons.push({ w: r.width, h: r.height, title: b.getAttribute('title') ?? '' })
    }
    return buttons
  })
  expect(sizes.length).toBeGreaterThanOrEqual(2)
  for (const s of sizes) {
    expect.soft(s.w, `${s.title} width`).toBeGreaterThanOrEqual(44)
    expect.soft(s.h, `${s.title} height`).toBeGreaterThanOrEqual(44)
  }
})

test('tab strip is tall enough for a finger on mobile', async ({ page }) => {
  await setupCleanVault(page)
  await page.goto('/')
  await waitForTestHooks(page)

  await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const note = ns.addNote({ title: 'Tab probe', folderId: null, content: '' })
    window.__noteser_test!.stores.workspaceStore.getState().openNote(note.id, { preview: false })
  })
  await page.waitForTimeout(200)

  // The tab is the first .border-t-2 ancestor near the top of the editor.
  // Simpler: find any draggable element with cursor-pointer inside the tab bar.
  const tabHeight = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[draggable="true"][class*="cursor-pointer"]')) as HTMLElement[]
    const editorTab = tabs.find((t) => t.querySelector('svg'))
    if (!editorTab) return 0
    return editorTab.getBoundingClientRect().height
  })
  expect(tabHeight).toBeGreaterThanOrEqual(44)
})
