import { test, expect, type Page } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: list / todo keyboard shortcuts
//
// Verifies the keyboard commands added in CodeMirrorEditor.tsx that bring the
// editor's list / todo behaviour in line with Obsidian:
//
//   Mod+L            Toggle checkbox status (plain/bullet/ordered -> task,
//                    task done <-> undone)          [Obsidian default]
//   Mod+Alt+Shift+L  Cycle list type:
//                    plain -> "1. " -> "- [ ] " -> plain
//   Alt+Up/Down      Move line, renumbering ordered lists afterwards
//   Mod+D            UNBOUND (was selectNextOccurrence; now a no-op)
//
// Strategy: Playwright's synthetic keyboard dispatch does NOT reliably reach
// CodeMirror's modified-chord handler (documented quirk in
// tasks-toggle-shortcut.spec.ts). The plain bindings (Mod+L, Alt+Arrow, Mod+D)
// dispatch cleanly via page.keyboard. For the Mod+Alt+Shift+L chord we send a
// real keydown through the editor's DOM with the exact properties CodeMirror's
// keymap matcher reads (key, code, ctrlKey, altKey, shiftKey), which the
// matcher resolves identically to a hardware press.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

async function getNoteContent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const ws = window.__noteser_test!.stores.workspaceStore.getState()
    const pane = ws.panes[0]
    const tab = pane?.tabs.find((t: { id: string }) => t.id === pane.activeTabId) as { noteId?: string } | undefined
    if (!tab?.noteId) return null
    const note = window.__noteser_test!.stores.noteStore.getState().notes
      .find((n: { id: string }) => n.id === tab.noteId!)
    return (note as { content?: string })?.content ?? null
  })
}

// The editor debounces saves to the note store by 300ms, so a read taken
// immediately after a keystroke can lag the actual editor text. Poll the store
// until the content settles to the expected value (or time out so a genuine
// mismatch still fails with a useful diff).
async function expectContent(page: Page, expected: string | RegExp): Promise<void> {
  await expect
    .poll(
      async () => {
        const content = (await getNoteContent(page)) ?? ''
        // For a RegExp matcher, reduce to a boolean so poll compares true===true
        // (expect.poll's toEqual is deep-equality, not regex matching).
        return expected instanceof RegExp ? expected.test(content) : content
      },
      { timeout: 4000, intervals: [100, 150, 200, 300] },
    )
    .toEqual(expected instanceof RegExp ? true : expected)
}

async function newNoteInEditMode(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)
  await page.getByTestId('ribbon-item-new-note').click()
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(false)
  })
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('.cm-content').first().click()
}

// Dispatch the Ctrl+Alt+Shift+L cycle chord straight at the focused
// .cm-content so CodeMirror's keymap matcher sees the precise modifier flags
// (Playwright's synthetic modified-press does not reliably reach the matcher).
async function pressCycleListType(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.cm-content') as HTMLElement | null
    if (!el) throw new Error('no .cm-content')
    el.focus()
    const ev = new KeyboardEvent('keydown', {
      key: 'L',
      code: 'KeyL',
      keyCode: 76,
      which: 76,
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    el.dispatchEvent(ev)
  })
  await page.waitForTimeout(250)
}

async function typeLine(page: Page, text: string) {
  await page.keyboard.type(text)
  await page.waitForTimeout(250)
}

test('Mod+L turns a plain line into an unchecked task', async ({ page }) => {
  await newNoteInEditMode(page)
  await typeLine(page, 'Buy milk')
  await expectContent(page, 'Buy milk')
  await page.keyboard.press('Control+l')
  await expectContent(page, '- [ ] Buy milk')
})

test('Mod+L marks an unchecked task done (with checkbox), then undone', async ({ page }) => {
  await newNoteInEditMode(page)
  await typeLine(page, '- [ ] Buy milk')
  await expectContent(page, /^- \[ \] Buy milk/)
  await page.keyboard.press('Control+l')
  await expectContent(page, /^- \[x\] Buy milk/)

  await page.keyboard.press('Control+l')
  await expectContent(page, /^- \[ \] Buy milk/)
  expect(await getNoteContent(page)).not.toMatch(/\[x\]/)
})

test('Mod+Alt+Shift+L cycles a line plain -> numbered -> task -> plain', async ({ page }) => {
  await newNoteInEditMode(page)
  await typeLine(page, 'Switch me')
  await expectContent(page, 'Switch me')
  // plain -> numbered
  await pressCycleListType(page)
  await expectContent(page, '1. Switch me')
  // numbered -> task
  await pressCycleListType(page)
  await expectContent(page, '- [ ] Switch me')
  // task -> plain
  await pressCycleListType(page)
  await expectContent(page, 'Switch me')
})

test('Mod+Alt+Shift+L cycles every line of a multi-line selection in step', async ({ page }) => {
  await newNoteInEditMode(page)
  await page.keyboard.type('alpha')
  await page.keyboard.press('Enter')
  await page.keyboard.type('beta')
  await page.keyboard.press('Enter')
  await page.keyboard.type('gamma')
  await expectContent(page, 'alpha\nbeta\ngamma')

  // Select all three lines, then cycle: plain -> numbered for the whole block.
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(100)
  await pressCycleListType(page)
  await expectContent(page, '1. alpha\n2. beta\n3. gamma')

  // Re-select (Ctrl+A) and cycle again: numbered -> task across the block.
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(100)
  await pressCycleListType(page)
  await expectContent(page, '- [ ] alpha\n- [ ] beta\n- [ ] gamma')

  // task -> plain for the whole block.
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(100)
  await pressCycleListType(page)
  await expectContent(page, 'alpha\nbeta\ngamma')
})

test('Mod+L still toggles done independently of the cycle key', async ({ page }) => {
  await newNoteInEditMode(page)
  await typeLine(page, 'Pay rent')
  await expectContent(page, 'Pay rent')
  // Mod+L turns the plain line into an unchecked task...
  await page.keyboard.press('Control+l')
  await expectContent(page, '- [ ] Pay rent')
  // ...then toggles it done...
  await page.keyboard.press('Control+l')
  await expectContent(page, /^- \[x\] Pay rent/)
  // ...and back undone. The cycle key (Mod+Alt+Shift+L) is not involved.
  await page.keyboard.press('Control+l')
  await expectContent(page, /^- \[ \] Pay rent/)
})

test('Alt+Down on an ordered list moves the item and renumbers 1,2,3', async ({ page }) => {
  await newNoteInEditMode(page)
  // Build a 3-item ordered list. Enter-continues-list produces the next "n."
  // automatically; renumber-on-edit keeps the sequence correct.
  await page.keyboard.type('1. alpha')
  await page.keyboard.press('Enter')
  await page.keyboard.type('beta')
  await page.keyboard.press('Enter')
  await page.keyboard.type('gamma')
  await expectContent(page, '1. alpha\n2. beta\n3. gamma')

  // Put the caret on line 1 ("alpha"): jump to document start, then move down.
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+Home')
  await page.waitForTimeout(150)
  await page.keyboard.press('Alt+ArrowDown')

  // alpha is now second; numbers must still read 1,2,3.
  await expectContent(page, '1. beta\n2. alpha\n3. gamma')
})

test('Mod+D no longer deletes / mangles the line (Obsidian leaves it unbound)', async ({ page }) => {
  await newNoteInEditMode(page)
  await typeLine(page, 'Keep this line intact')
  await expectContent(page, 'Keep this line intact')

  await page.keyboard.press('Control+d')
  await page.waitForTimeout(300)
  // The line must be untouched — Mod+D used to run selectNextOccurrence; now
  // it is unbound, so the content is unchanged.
  await expectContent(page, 'Keep this line intact')
})
