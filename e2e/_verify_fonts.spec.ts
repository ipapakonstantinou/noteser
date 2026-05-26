import { test, expect, type Page } from '@playwright/test'

// Font options verification (fnt1). Utility spec (underscore prefix =
// excluded from the default suite). Run explicitly:
//   npx playwright test e2e/_verify_fonts.spec.ts
//
// Verifies: default look is unchanged (CSS vars carry the historical
// stacks), a custom Text font applies live to editor + reading mode, a
// custom code font applies to code, and the choice persists across reload.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch {}
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch {}
    // Suppress first-run onboarding so it doesn't block interactions.
    try {
      window.localStorage.setItem('noteser-settings', JSON.stringify({
        state: { onboardingShown: true },
        version: 2,
      }))
    } catch {}
  })
})

async function openSettings(page: Page) {
  await page.keyboard.press('Control+,')
  await expect(page.getByTestId('settings-categories')).toBeVisible()
}

async function waitForHooks(page: Page) {
  await page.waitForFunction(
    () => typeof (window as unknown as { __noteser_test?: unknown }).__noteser_test !== 'undefined',
    undefined,
    { timeout: 10_000 },
  )
}

async function seedAndOpen(page: Page, title: string, content: string) {
  await waitForHooks(page)
  await page.evaluate(({ title, content }) => {
    const hooks = (window as unknown as {
      __noteser_test: {
        stores: {
          noteStore: { getState(): { addNote: (i: { title: string; content: string }) => { id: string } } }
          workspaceStore: { getState(): { openNote: (id: string, opt: { preview: boolean }) => void } }
        }
      }
    }).__noteser_test
    const note = hooks.stores.noteStore.getState().addNote({ title, content })
    hooks.stores.workspaceStore.getState().openNote(note.id, { preview: false })
  }, { title, content })
}

function rootVar(page: Page, name: string) {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  )
}

test('default install leaves font CSS vars at the historical stacks', async ({ page }) => {
  await page.goto('/')
  await waitForHooks(page)
  // The vars come from globals.css :root (no inline override set), so
  // they read as the historical monospace / Inter stacks → no change.
  expect(await rootVar(page, '--font-text')).toContain('monospace')
  expect(await rootVar(page, '--font-mono')).toContain('monospace')
  expect(await rootVar(page, '--font-interface')).toContain('Inter')
  // No inline override on the documentElement style attribute.
  const inlineText = await page.evaluate(() => document.documentElement.style.getPropertyValue('--font-text'))
  expect(inlineText).toBe('')
})

test('a custom Text font applies live to editor + reading mode', async ({ page }) => {
  await page.goto('/')
  await seedAndOpen(page, 'Font test', '# Heading\n\nSome body text here.')

  await openSettings(page)
  await page.getByTestId('settings-cat-appearance').click()
  await expect(page.getByTestId('settings-fonts')).toBeVisible()

  // Pick "Custom…" for the Text slot and type a recognisable family.
  await page.getByTestId('font-select-text').selectOption('__custom__')
  const customText = page.getByTestId('font-custom-text')
  await customText.fill('Comic Sans MS')
  await customText.blur()

  // The inline override lands on :root with the chosen family + fallback.
  await expect.poll(() => page.evaluate(
    () => document.documentElement.style.getPropertyValue('--font-text'),
  )).toContain('Comic Sans MS')

  // Close settings, confirm the editor content computed font reflects it.
  await page.keyboard.press('Escape')
  const editorFont = await page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    return el ? getComputedStyle(el).fontFamily : ''
  })
  expect(editorFont).toContain('Comic Sans MS')

  // Switch to reading mode and confirm the prose body reflects it too.
  await page.getByTestId('editor-header-preview-toggle').click().catch(() => {})
  await expect.poll(async () => {
    return page.evaluate(() => {
      const el = document.querySelector('.prose')
      return el ? getComputedStyle(el).fontFamily : ''
    })
  }).toContain('Comic Sans MS')
})

test('a custom code font applies to code, and persists across reload', async ({ page }) => {
  await page.goto('/')
  await seedAndOpen(page, 'Code test', 'Inline `code` and a block:\n\n```\nplain block\n```')

  await openSettings(page)
  await page.getByTestId('settings-cat-appearance').click()
  await page.getByTestId('font-select-mono').selectOption('__custom__')
  const customMono = page.getByTestId('font-custom-mono')
  await customMono.fill('Courier New')
  await customMono.blur()

  await expect.poll(() => page.evaluate(
    () => document.documentElement.style.getPropertyValue('--font-mono'),
  )).toContain('Courier New')

  // Sanity: the choice is persisted to the settings store in
  // localStorage (vault-synced slice) before we reload.
  const persisted = await page.evaluate(() => window.localStorage.getItem('noteser-settings') ?? '')
  expect(persisted).toContain('Courier New')

  // Reload — the choice persists and re-applies on boot. NOTE: the
  // beforeEach init-script clears localStorage on every navigation
  // (incl. reload), which would defeat the test, so re-seed the
  // persisted settings right before reloading by stashing + restoring.
  await page.addInitScript((saved) => {
    try { window.localStorage.setItem('noteser-settings', saved) } catch {}
  }, persisted)
  await page.reload()
  await waitForHooks(page)
  await expect.poll(() => page.evaluate(
    () => document.documentElement.style.getPropertyValue('--font-mono'),
  )).toContain('Courier New')

  // And it's still shown in the Settings UI as a Custom value.
  await openSettings(page)
  await page.getByTestId('settings-cat-appearance').click()
  await expect(page.getByTestId('font-custom-mono')).toHaveValue('Courier New')
})
