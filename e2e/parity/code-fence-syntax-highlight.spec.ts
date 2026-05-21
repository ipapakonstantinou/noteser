import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

// Obsidian-parity scenario: code-fence-syntax-highlight
//
// Obsidian behavior: triple-backtick code fences with a language tag
// render with syntax highlighting in preview mode.
//
// Noteser today: the rendered preview uses react-markdown with
// remark/rehype plugins. Code blocks in preview mode render via the
// CodeBlock component which uses refractor/prismjs for token highlighting.
// In live-edit (CodeMirror) mode, CodeMirror itself does syntax
// highlighting via the markdown extension.

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)
})

test('code fence with language tag renders highlighted tokens in preview', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  const noteContent = [
    '```javascript',
    'function hello() {',
    '  return "world"',
    '}',
    '```',
  ].join('\n')

  const noteId = await page.evaluate((content) => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note = store.addNote({ folderId: null })
    store.updateNote(note.id, { content })
    return note.id
  }, noteContent)

  // Open note in rendered preview mode.
  await page.evaluate((nId) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(nId, { preview: false })
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  }, noteId)

  await expect(page.locator('.prose')).toBeVisible({ timeout: 10_000 })

  // The code block should be inside a <pre><code> element.
  const codeBlock = page.locator('.prose pre code').first()
  await expect(codeBlock).toBeVisible()

  // Prism tokens are wrapped in <span class="token ..."> elements.
  // We look for at least one token span inside the code block.
  const tokenSpans = codeBlock.locator('span[class*="token"]')
  const tokenCount = await tokenSpans.count()
  expect(tokenCount).toBeGreaterThan(0)
})

test('code fence without language tag renders as plain code (no crash)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  const noteContent = ['```', 'just plain code', 'no language specified', '```'].join('\n')

  const noteId = await page.evaluate((content) => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note = store.addNote({ folderId: null })
    store.updateNote(note.id, { content })
    return note.id
  }, noteContent)

  await page.evaluate((nId) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(nId, { preview: false })
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  }, noteId)

  await expect(page.locator('.prose')).toBeVisible({ timeout: 10_000 })

  // Should render a <pre><code> block without crashing.
  await expect(page.locator('.prose pre code').first()).toBeVisible()
  await expect(page.locator('.prose pre code').first()).toContainText('just plain code')
})

test('inline backtick code renders as <code> element', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  const noteId = await page.evaluate(() => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note = store.addNote({ folderId: null })
    store.updateNote(note.id, { content: 'Use `console.log()` for debugging.' })
    return note.id
  })

  await page.evaluate((nId) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(nId, { preview: false })
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  }, noteId)

  await expect(page.locator('.prose')).toBeVisible({ timeout: 10_000 })

  // Inline code should render as <code> (not <pre>).
  const inlineCode = page.locator('.prose code').filter({ hasNotText: '' }).first()
  // More specifically: look for a code element not inside a pre.
  const inlineOnlyCode = page.locator('.prose p code').first()
  await expect(inlineOnlyCode).toBeVisible()
  await expect(inlineOnlyCode).toContainText('console.log()')
})

test('Python code fence renders highlighted tokens', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)

  const noteContent = ['```python', 'def greet(name):', '    return f"Hello {name}"', '```'].join('\n')

  const noteId = await page.evaluate((content) => {
    const store = window.__noteser_test!.stores.noteStore.getState()
    const note = store.addNote({ folderId: null })
    store.updateNote(note.id, { content })
    return note.id
  }, noteContent)

  await page.evaluate((nId) => {
    window.__noteser_test!.stores.workspaceStore.getState().openNote(nId, { preview: false })
    window.__noteser_test!.stores.uiStore.getState().setPreviewMode(true)
  }, noteId)

  await expect(page.locator('.prose')).toBeVisible({ timeout: 10_000 })

  const codeBlock = page.locator('.prose pre code').first()
  await expect(codeBlock).toBeVisible()

  // Python def + string tokens should get syntax highlighting.
  const tokens = codeBlock.locator('span[class*="token"]')
  const count = await tokens.count()
  expect(count).toBeGreaterThan(0)
})
