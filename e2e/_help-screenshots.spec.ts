/**
 * _help-screenshots.spec.ts
 *
 * Playwright script that seeds the app with a small sample vault and
 * captures the five screenshots referenced by `src/help/content.ts`
 * under `public/screenshots/help/`. Filenames are stable so the
 * markdown references keep working.
 *
 * Run:
 *   npx playwright test e2e/_help-screenshots.spec.ts --project=chromium
 *
 * Output: public/screenshots/help/*.png at 1440x900.
 *
 * Filename starts with `_` so the regular suite ignores it (see
 * `testIgnore` in playwright.config.ts).
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const OUT = path.resolve(__dirname, '..', 'public', 'screenshots', 'help')

test.use({ viewport: { width: 1440, height: 900 } })

// Hide the Next.js dev overlay ("1 Issue" pill) so screenshots don't
// pick up dev-mode chrome. Injected at every page load.
const HIDE_DEV_OVERLAY_CSS = `
  nextjs-portal { display: none !important; }
  [data-nextjs-toast], [data-nextjs-dev-tools-button] { display: none !important; }
`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Pre-mark onboarding shown so the welcome modal doesn't intercept
    // clicks during seeding.
    try {
      const raw = window.localStorage.getItem('noteser-settings')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      parsed.state = parsed.state || {}
      parsed.state.onboardingShown = true
      window.localStorage.setItem('noteser-settings', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
})

// Hide the Next.js dev overlay ("1 Issue" pill at the bottom of the
// viewport in `npm run dev`). The overlay lives in a `<nextjs-portal>`
// custom element appended to <body>. We hide it via a top-level style
// tag injected AFTER navigation, just before each screenshot.
async function hideDevChrome(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: `
      nextjs-portal { display: none !important; }
      [data-nextjs-toast], [data-nextjs-dev-tools-button] { display: none !important; }
    `,
  }).catch(() => { /* no-op if document is not ready yet */ })
}

const SAMPLE_NOTES = [
  {
    id: 'n1',
    title: 'My first note',
    content: `# My first note

Welcome to noteser. Write your notes in plain markdown — every change saves automatically.

## Things to try today

- [x] Open the app
- [x] Read this welcome note
- [ ] Write your first task
- [ ] Tag a note with #ideas

## A quick code sample

\`\`\`typescript
const greet = (name: string) => \`Hello, \${name}!\`
greet('noteser')
\`\`\`

> "Knowledge compounds." — Naval

See also: [[Project plan]]
`,
  },
  {
    id: 'n2',
    title: 'Project plan',
    content: `# Project plan

## Goals

- Ship the new pipeline by Friday
- Cut the staging error rate in half

## Open items

- [ ] Wire up alerting
- [ ] Define SLOs with #ops
- [ ] Write the runbook
`,
  },
  {
    id: 'n3',
    title: 'Daily 2026-06-08',
    content: `# Daily 2026-06-08

## Done today

- [x] Refactored the sync pipeline
- [x] Shipped the streak counter

## Tomorrow

- [ ] Talk to #team about the new tool

#journal
`,
  },
]

const SAMPLE_FOLDERS = [
  { id: 'f1', name: 'Notes', parentId: null },
  { id: 'f2', name: 'Daily', parentId: 'f1' },
  { id: 'f3', name: 'Projects', parentId: null },
]

async function seed(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__noteser_test)

  await page.evaluate(({ notes, folders }) => {
    const t = window.__noteser_test!
    // Force the sidebar into the two-group default (calendar group on
    // top, files group on bottom). Persisted settings sometimes collapse
    // to a single group on a fresh hydrate; this guarantees the folder
    // tree is visible in every shot that needs it.
    t.stores.settingsStore.setState({
      sidebarGroups: [
        { id: 'g-cal', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
        {
          id: 'g-files',
          tabs: ['files', 'outline', 'search', 'bookmarks'],
          activeTab: 'files',
          collapsed: false,
        },
      ],
    })
    t.stores.folderStore.setState({
      folders: folders.map((f, i) => ({
        ...f,
        order: i,
        createdAt: Date.now() + i,
        updatedAt: Date.now() + i,
        isDeleted: false,
        deletedAt: null,
      })),
      activeFolderId: null,
      expandedFolders: { f1: true, f2: true, f3: true },
    })
    const folderForIndex = (i: number) => {
      if (i === 0) return null
      if (i === 1) return 'f3'
      return 'f2'
    }
    t.stores.noteStore.setState({
      notes: notes.map((n, i) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        folderId: folderForIndex(i),
        createdAt: Date.now() - (notes.length - i) * 1000,
        updatedAt: Date.now() - (notes.length - i) * 1000,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      })),
      selectedNoteId: notes[0].id,
    })
    t.stores.workspaceStore.setState({
      panes: [{
        id: 'pane-1',
        tabs: [{ id: 'tab-1', kind: 'note', noteId: notes[0].id, isPreview: false }],
        activeTabId: 'tab-1',
      }],
      activePaneId: 'pane-1',
      mergeAppliedCount: 0,
    })
  }, { notes: SAMPLE_NOTES, folders: SAMPLE_FOLDERS })

  await page.waitForTimeout(500)
}

test('getting-started-first-note', async ({ page }) => {
  await seed(page)
  // Collapse the calendar group so the Files / folder tree dominates
  // the left rail — this is the "first note open in the workspace" shot.
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.setState({
      sidebarGroups: [
        { id: 'g-files', tabs: ['files'], activeTab: 'files', collapsed: false },
      ],
    })
  })
  await page.waitForTimeout(400)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await hideDevChrome(page)
  await page.waitForTimeout(200)
  await page.screenshot({
    path: path.join(OUT, 'getting-started-first-note.png'),
    fullPage: false,
  })
})

test('editor-live-preview', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.setState({
      sidebarGroups: [
        { id: 'g-files', tabs: ['files'], activeTab: 'files', collapsed: false },
      ],
    })
  })
  await page.waitForTimeout(300)
  // Click into the editor body so the cursor is in-frame — live preview
  // shows both the rendered look AND cursor-aware markup.
  await page.locator('.cm-content').click()
  await page.waitForTimeout(300)
  await hideDevChrome(page)
  await page.screenshot({
    path: path.join(OUT, 'editor-live-preview.png'),
    fullPage: false,
  })
})

test('sidebar-pane-model', async ({ page }) => {
  await seed(page)
  // Two sidebar groups so the shot demonstrates the Obsidian-style
  // stacked pane layout (one mini-tab strip + body per group).
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.setState({
      sidebarGroups: [
        { id: 'g-shot-1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
        { id: 'g-shot-2', tabs: ['files'], activeTab: 'files', collapsed: false },
      ],
    })
  })
  await page.waitForTimeout(400)
  await hideDevChrome(page)
  await page.screenshot({
    path: path.join(OUT, 'sidebar-pane-model.png'),
    fullPage: false,
  })
})

test('search-quick-switcher', async ({ page }) => {
  await seed(page)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.keyboard.type('proj', { delay: 60 })
  await page.waitForTimeout(400)
  await hideDevChrome(page)
  await page.screenshot({
    path: path.join(OUT, 'search-quick-switcher.png'),
    fullPage: false,
  })
})

test('github-sync-settings', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await page.waitForTimeout(500)
  const sync = page.getByText(/^Sync$|GitHub sync/i).first()
  if (await sync.isVisible()) {
    await sync.click()
    await page.waitForTimeout(300)
  }
  await hideDevChrome(page)
  await page.screenshot({
    path: path.join(OUT, 'github-sync-settings.png'),
    fullPage: false,
  })
})
