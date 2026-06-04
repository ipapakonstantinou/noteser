/**
 * refresh-tour-screenshots.ts
 *
 * Playwright script that seeds the app with sample data and re-captures
 * the nine feature-tour screenshots bundled in `public/feature-tour/`.
 *
 * Why this file is separate from `e2e/_screenshots.spec.ts`:
 *   `_screenshots.spec.ts` writes to `docs/images/` for marketing docs.
 *   The Feature tour note (`src/utils/featureTourNote.ts`) references
 *   `public/feature-tour/<name>.png` instead. After the accent-color
 *   swap from purple to noteser blue the bundled tour PNGs went stale,
 *   so this script regenerates them in place.
 *
 * Run from the worktree root:
 *   npx playwright test scripts/refresh-tour-screenshots.ts \
 *     --project=chromium --config=scripts/refresh-tour-screenshots.config.ts
 *
 * Output: public/feature-tour/<name>.png at 1440x900.
 *
 * The TUTORIAL_IMAGES filename list in `src/utils/featureTourNote.ts`
 * is the source of truth for what each PNG should depict — keep these
 * captures aligned with that file by filename.
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const OUT = path.resolve(__dirname, '..', 'public', 'feature-tour')

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  // Start every capture from a clean slate so screenshots are
  // deterministic regardless of dev-time localStorage drift.
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    // Pre-mark onboarding as shown so the full-screen modal does not
    // intercept clicks while we are seeding.
    try {
      const raw = window.localStorage.getItem('noteser-settings')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      parsed.state = parsed.state || {}
      parsed.state.onboardingShown = true
      window.localStorage.setItem('noteser-settings', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
})

// Sample notes built once and reused across the captures that need a
// realistic-looking vault.
const SAMPLE_NOTES = [
  {
    id: 'n1',
    title: 'Welcome to noteser',
    content: `# Welcome to noteser

A markdown notes app with the **Obsidian** mental model, fully in the browser, synced to **GitHub**.

## What you can do here

- Write notes in pure markdown
- Organise them into folders, drag-and-drop to rearrange
- Tag with #ideas, #work, #journal — tags appear in the sidebar automatically
- Link between notes with [[wikilinks]]
- Track tasks with - [ ] checkboxes

## Today's tasks

- [x] Set up the workspace
- [x] Sync to GitHub
- [ ] Write the team standup notes
- [ ] Review #ml-pipeline PRs

## A code block

\`\`\`typescript
const greet = (name: string) => \`Hello, \${name}!\`
greet('noteser')
\`\`\`

> "Knowledge compounds." — Naval

See also: [[Project plan]], [[Daily 2026-05-21]]
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
- [ ] Write runbook
`,
  },
  {
    id: 'n3',
    title: 'Daily 2026-05-21',
    content: `# Daily 2026-05-21

## Done today
- [x] Refactored the sync pipeline
- [x] Shipped the streak counter

## Tomorrow
- [ ] Talk to #team about the new tool
`,
  },
  {
    id: 'n4',
    title: 'Daily 2026-05-20',
    content: `# Daily 2026-05-20

## Done
- [x] Customised the theme
- [x] Wrote up the weekly review

#journal
`,
  },
  {
    id: 'n5',
    title: 'Meeting notes — review',
    content: `# Meeting notes — review

## Attendees
- Monica
- Tassilo
- Ioannis

## Agenda
1. Pilot proposal
2. Tooling

#work
`,
  },
]

const SAMPLE_FOLDERS = [
  { id: 'f1', name: 'Notes', parentId: null },
  { id: 'f2', name: 'Notes/Daily', parentId: 'f1' },
  { id: 'f3', name: 'Projects', parentId: null },
]

async function seed(page: import('@playwright/test').Page) {
  // Wait for the app and test hooks to be installed.
  await page.goto('/')
  await page.waitForFunction(() => !!window.__noteser_test)

  await page.evaluate(({ notes, folders }) => {
    const t = window.__noteser_test!
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
      if (i === 2 || i === 3) return 'f2'
      return 'f3'
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

  // Give React a moment to re-render with the seeded state.
  await page.waitForTimeout(500)
}

test('00 — welcome tab', async ({ page }) => {
  // First-run state: no notes, onboarding NOT marked shown, no GitHub.
  // page.tsx auto-opens the welcome tab on hydrate.
  await page.addInitScript(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('noteser-settings') || '{}')
      parsed.state = parsed.state || {}
      parsed.state.onboardingShown = false
      window.localStorage.setItem('noteser-settings', JSON.stringify(parsed))
    } catch { /* ignore */ }
  })
  await page.goto('/')
  await expect(page.getByTestId('welcome-pane')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, '00-welcome.png'), fullPage: false })
  console.log('captured 00-welcome.png')
})

test('01 — editor hero', async ({ page }) => {
  await seed(page)
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await page.screenshot({ path: path.join(OUT, '01-editor-hero.png'), fullPage: false })
  console.log('captured 01-editor-hero.png')
})

test('02 — live preview', async ({ page }) => {
  await seed(page)
  // The default selection is the Welcome note. Click into the editor
  // content area so the cursor is visible (live preview shows both the
  // rendered output and cursor-aware markup).
  await page.locator('.cm-content').click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(OUT, '02-live-preview.png'), fullPage: false })
  console.log('captured 02-live-preview.png')
})

test('03 — sidebar pane model', async ({ page }) => {
  await seed(page)
  // Two stacked groups so the screenshot demonstrates the leaf-model
  // pane layout (a mini-strip per group, body below each).
  await page.evaluate(() => {
    window.__noteser_test!.stores.settingsStore.setState({
      sidebarGroups: [
        { id: 'shot-1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
        { id: 'shot-2', tabs: ['files'], activeTab: 'files', collapsed: false },
      ],
    })
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, '03-sidebar-pane-model.png'), fullPage: false })
  console.log('captured 03-sidebar-pane-model.png')
})

test('04 — quick switcher', async ({ page }) => {
  await seed(page)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  // Type a few letters so results show up.
  await page.keyboard.type('proj', { delay: 60 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, '04-quick-switcher.png'), fullPage: false })
  console.log('captured 04-quick-switcher.png')
})

test('05 — templates modal', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'template' })
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, '05-templates-modal.png'), fullPage: false })
  console.log('captured 05-templates-modal.png')
})

test('06 — export modal (PDF)', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'export' })
  })
  await page.waitForTimeout(500)
  const pdfBtn = page.getByText('PDF', { exact: true })
  if (await pdfBtn.isVisible()) await pdfBtn.click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(OUT, '06-export-modal-pdf.png'), fullPage: false })
  console.log('captured 06-export-modal-pdf.png')
})

test('07 — settings + theme editor', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await page.waitForTimeout(500)
  const appearance = page.getByText(/Appearance/i).first()
  if (await appearance.isVisible()) {
    await appearance.click()
    await page.waitForTimeout(200)
  }
  await page.screenshot({ path: path.join(OUT, '07-theme-editor.png'), fullPage: false })
  console.log('captured 07-theme-editor.png')
})

test('08 — github sync settings (gitignore editor)', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => {
    window.__noteser_test!.stores.uiStore.getState().openModal({ type: 'settings' })
  })
  await page.waitForTimeout(500)
  const sync = page.getByText(/^Sync$|GitHub sync/i).first()
  if (await sync.isVisible()) {
    await sync.click()
    await page.waitForTimeout(200)
  }
  await page.screenshot({ path: path.join(OUT, '08-sync-settings.png'), fullPage: false })
  console.log('captured 08-sync-settings.png')
})
