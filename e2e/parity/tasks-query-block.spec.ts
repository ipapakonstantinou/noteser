import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// QA gap coverage: tasks query blocks (```tasks fences) + task completion.
//
// Jon asked for "- [ ] and completion, tasks query blocks". A ```tasks
// fence aggregates matching tasks across the vault into a rendered widget
// with toggleable checkboxes. Rendered-preview only (live preview shows
// the raw fence). Toggling a checkbox should flip the source note's task.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('a ```tasks block aggregates open tasks and a checkbox toggle completes the source task', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  // Seed two source notes with open tasks, then a host note with a
  // tasks-query fence selecting "not done".
  const ids = await page.evaluate(() => {
    const ns = window.__noteser_test!.stores.noteStore.getState()
    const src = ns.addNote({
      title: 'Project Plan',
      content: '- [ ] Buy milk\n- [ ] Walk dog\n- [x] Already done thing',
    })
    const host = ns.addNote({
      title: 'Dashboard',
      content: '# Open tasks\n\n```tasks\nnot done\n```\n',
    })
    // notesOpenInPreviewMode defaults to true, so the host opens in
    // rendered preview and the TaskQueryBlock widget mounts naturally.
    // (Forcing setPreviewMode after openNote double-mounts the widget —
    // an edit pane + a preview pane — so we rely on the natural default.)
    window.__noteser_test!.stores.workspaceStore.getState().openNote(host.id, { preview: false })
    return { srcId: src.id }
  })

  // Scope to the rendered-preview surface (.prose). The CodeMirror edit
  // pane stays DOM-mounted behind the preview and contains its own copy
  // of the widget, but only the .prose one is what the user sees.
  const preview = page.locator('.prose').first()

  // The two open tasks should appear in the rendered query block; the
  // completed one ("Already done thing") should NOT (filter = not done).
  await expect(preview.getByText('Buy milk')).toBeVisible({ timeout: 10_000 })
  await expect(preview.getByText('Walk dog')).toBeVisible()
  await expect(preview.getByText('Already done thing')).toHaveCount(0)

  // Toggle the first task's checkbox in the rendered widget. The widget is
  // a `.not-prose` island; find the visible "Buy milk" row's checkbox.
  const buyMilkRow = preview.locator('li', { hasText: 'Buy milk' }).first()
  const cb = buyMilkRow.locator('input[type="checkbox"]')
  await expect(cb).toBeVisible({ timeout: 5000 })
  await cb.click()

  // The source note's content should now mark "Buy milk" done.
  const completed = await page.evaluate((srcId) => {
    const note = window.__noteser_test!.stores.noteStore.getState().notes.find(n => n.id === srcId)
    return note?.content.includes('- [x] Buy milk') ?? false
  }, ids.srcId)
  expect(completed).toBe(true)
})
