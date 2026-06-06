# Testing — process & rules

Single source of truth for how testing works in noteser and the rules every
tester (human or subagent) must follow. The two test-running subagents
(`.claude/agents/tester.md` for unit, `.claude/agents/qa-tester.md` for E2E)
defer to this document — keep them in sync when a rule changes here.

There are **three** test layers. Use the cheapest one that can prove the thing:

| Layer | Runner | Lives in | Speed | When |
|---|---|---|---|---|
| Unit / integration | Jest + jsdom | `src/__tests__/*.test.ts(x)` | fast | Default. Utils, stores, hooks, components. |
| End-to-end (parity) | Playwright + Chromium | `e2e/`, `e2e/parity/` | slow | Real user flows, Obsidian-parity behavior, anything needing the real DOM/CodeMirror. |
| Live GitHub sync | Jest, real network | `src/__tests__/e2eSyncLive.test.ts` | slowest | Only when you touch sync logic. Needs a token. Not in the default loop. |

CI (`.github/workflows/ci.yml`) gates `main`/`dev` on **lint → typecheck →
`npm test` → build**. Playwright is **not** in CI — E2E is run on demand.

## Commands

```bash
npm test                       # full Jest run (~1879 tests)
npx jest <path>                # single file: npx jest src/__tests__/tags.test.ts
npx jest -t "<pattern>"        # match by test name
npm run test:watch             # watch mode
npm run test:coverage          # coverage report

npm run e2e                    # full Playwright run (headless, auto-boots dev server on :3001)
npm run e2e:headed             # visible browser
npx playwright test e2e/parity/<file>.spec.ts   # single spec
npx playwright test --grep "<title>"            # match by test title
npm run e2e:report             # open the HTML report after a run

npm run e2e:sync               # live sync harness (needs a token — see below)
```

Run the local gate before pushing: `npm run lint && npm run typecheck && npm test && npm run build`.

---

## Part 1 — Unit tests (Jest)

### Layout & environment

- Files: `src/__tests__/<name>.test.ts` (logic) or `.test.tsx` (React). One subdir
  today: `src/__tests__/plugins/`. Name the file after what it tests, not after a
  ticket (`tags.test.ts`, `useGitHubSync.test.ts`).
- Config: `jest.config.js` (via `next/jest`). Default env is **jsdom**. Setup runs
  `jest.setup.js` (jest-dom matchers + `TextEncoder`/`TextDecoder`/`Response` polyfills).
- Need real Node APIs (native `fetch`, no jsdom)? Put `@jest-environment node` at the
  top of the file — see `githubFetch.test.ts`, `plugins/installer.test.ts`.
- `@/` → `src/`.

### Mock at boundaries, run real code everywhere else

The house style is **high-fidelity tests**. Only mock at system boundaries —
`fetch`, `idb-keyval`/IndexedDB, the GitHub API, time. Everything else runs for
real (e.g. `markdownLivePreview.test.ts` drives the real CodeMirror packages, not
stubs). A test that mocks the thing it is testing proves nothing.

**`idb-keyval` is the one mock almost every test needs**, because Zustand's persist
middleware writes through it. Declare it at the top of the file, *before* any store
import:

```ts
// no-op variant — most tests
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))
```

```ts
// in-memory variant — when you need round-trip save/get (e.g. attachments.test.ts)
const idb = new Map<string, unknown>()
jest.mock('idb-keyval', () => ({
  get: jest.fn((k: string) => Promise.resolve(idb.get(k))),
  set: jest.fn((k: string, v: unknown) => { idb.set(k, v); return Promise.resolve() }),
  del: jest.fn((k: string) => { idb.delete(k); return Promise.resolve() }),
  keys: jest.fn(() => Promise.resolve([...idb.keys()])),
}))
beforeEach(() => idb.clear())
```

### Store isolation (Zustand)

Reset state with `setState` in `beforeEach` — never by re-importing the store, and
never rely on test order:

```ts
beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  useUIStore.getState().closeModal()
})
```

Read and drive state through the Zustand API: `useStore.getState()` to read/call
actions. For hydration-specific tests, control it with
`jest.spyOn(useNoteStore.persist, 'hasHydrated')` and restore in `afterEach` with
`jest.restoreAllMocks()` (see `useStoresHydrated.test.tsx`).

### Mocking patterns

- **Whole module:** `jest.mock('../utils/githubSync', () => ({ pullFromGitHub: (...a) => mock(...a) }))`,
  declared before imports. `mockReset()` it in `beforeEach`.
- **One method, keep the rest real:** `jest.spyOn(mod, 'fn')`, then `jest.restoreAllMocks()` in `afterEach`.
- **fetch:** assign `global.fetch = jest.fn()`. Sequence multi-call flows with
  `.mockResolvedValueOnce(...)`. We deliberately do **not** polyfill a global fetch —
  each test mocks it explicitly so the mock is unambiguous.
- **time:** `jest.useFakeTimers()` + `jest.advanceTimersByTime(ms)`; pair with
  `jest.useRealTimers()` in `afterEach` (see `toastStore.test.ts`).

### Conventions

- `describe('subject', () => { test('does X', () => { … }) })`. Use **`test`**, not `it`.
  Titles are statements: `'addToast returns an id and appends the toast'`.
- Components: `render()` from `@testing-library/react`, query by role/text, drive with
  `userEvent.setup()`. Wrap async/state changes and hooks in `act()` /
  `await act(async () => …)`. `renderHook` for hooks.
- Keep helpers/factories inline in the file (`makeRes`, `resetStores`). No premature
  `test-utils/` abstraction — extract only when genuinely reused.
- Start coverage with pure utils (`extractTags`, `sanitizeFilename`, `lineDiff`,
  `taskQuery`) — cheapest, highest signal.

### Don't

- No snapshot tests except for small pure data structures — they rot.
- Don't add a dependency to write a test without flagging it first.
- Don't "verify" with `npm run build` — a build is not a test.
- Don't `git commit`/`git push` from the unit-test subagent — report and hand back.

---

## Part 2 — End-to-end (Playwright)

### Two directories

- **`e2e/parity/`** — exploratory, one spec per scenario from `e2e/obsidian-parity.md`.
  Written/owned by the `qa-tester` subagent. May be flaky while iterating. Slug-cased
  filenames matching the scenario heading (`create-note-via-button.spec.ts`).
- **`e2e/`** (root) — graduated, stable specs that run as the real suite. Moving a spec
  from `parity/` to here is a **manual decision** — the agent proposes, the human moves.
- **`_*.spec.ts`** — utility scripts that piggyback on the runner (screenshots,
  deployed-app verifiers). Excluded by `testIgnore: '**/_*.spec.ts'`; run explicitly.

### Bootstrap every spec

Import from `e2e/parity/_helpers.ts`:

```ts
import { test, expect } from '@playwright/test'
import { setupCleanVault, waitForTestHooks } from './_helpers'

test.beforeEach(async ({ page }) => {
  await setupCleanVault(page)   // clears localStorage + IndexedDB, suppresses onboarding modal
})

test('…', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('folder-tree')).toBeVisible()
  await waitForTestHooks(page)  // wait for hydration before touching window.__noteser_test
  // …
})
```

- `setupCleanVault` runs an `addInitScript` that clears `localStorage`, deletes the
  `noteser` + `keyval-store` IndexedDB DBs, and pre-seeds `noteser-settings` with
  `onboardingShown: true`. **If your scenario needs the onboarding/welcome modal, do not
  call it** — seed `onboardingShown: false` yourself (see `welcome-fresh-tab-opens.spec.ts`).
- `waitForTestHooks` polls for `window.__noteser_test`, which only exists after React
  hydration. The folder-tree HTML is visible earlier via SSR, so asserting it visible is
  **not** enough before you reach into the store.

### Seed state through the store API, not 20 clicks

`window.__noteser_test` (defined in `src/utils/testHooks.ts`) exposes the live stores,
the attachments helpers, and `lastPushedContent`. Seed via `page.evaluate` — faster and
more deterministic than driving the whole UI:

```ts
const id = await page.evaluate(() => {
  const s = window.__noteser_test!.stores.noteStore.getState()
  const n = s.addNote({ folderId: null })
  s.updateNote(n.id, { title: 'Hello', content: 'body' })
  window.__noteser_test!.stores.workspaceStore.getState().openNote(n.id, { preview: false })
  return n.id
})
```

Available stores: `noteStore`, `folderStore`, `settingsStore`, `workspaceStore`,
`uiStore`, `githubStore`. Always reach them inside `page.evaluate` (browser context) —
never from Node.

### Locators (most stable → last resort)

1. `getByTestId('folder-tree')` — **preferred**. Add a `data-testid` if one is missing
   rather than reaching for a fragile selector. Dynamic ids carry the entity:
   `sidebar-tab-${tabId}`, `[data-testid="note-row"][data-note-id="${id}"]`.
2. `getByRole('button', { name: 'Delete' })`, `getByRole('dialog')` — standard widgets.
   Scope modal queries: `page.getByRole('dialog').getByText(…)` (modals trap focus).
3. `getByText('2026-W11.md')` — stable visible text.
4. CSS (`.cm-content`, `.prose pre code`) — only when nothing above fits.

### Known pitfalls (copy the working pattern)

- **CodeMirror editor:** never `.fill()` it. Type via
  `page.locator('.cm-content').click()` then `page.keyboard.type(...)`.
- **HTML5 drag-and-drop is flaky** under Playwright's native `dragTo`. Dispatch events
  with a manual `DataTransfer` instead (`drag-note-into-folder.spec.ts`,
  `attachment-drag.spec.ts`). MIME types: notes `application/x-noteser-note`, tabs
  `application/x-noteser-tab`.
- **Pin/unpin a sidebar tab** goes through a context menu now — use `pinTabViaMenu` /
  `unpinTabViaMenu` from `_helpers.ts`.

### No flaky waits

- Prefer asserting **store state** (synchronous, race-free) over DOM timing:
  `await page.evaluate(() => …getState().notes.filter(n => n.isDeleted).length)`.
- Poll with web-first assertions / `expect.toPass`, never a bare `waitForTimeout`:

```ts
await expect(async () => {
  expect(await page.locator('.cm-diff-added').count()).toBeGreaterThan(0)
}).toPass({ timeout: 5000 })
```

- Give slow mounts a generous timeout on the assertion itself
  (`toBeVisible({ timeout: 10_000 })`) instead of sleeping.

### Config & artifacts

- `playwright.config.ts`: `testDir: ./e2e`, single worker, 30s/test, auto-boots
  `npm run dev` on :3001 (reuses an existing server locally). On failure it retains
  **trace + screenshot + video** in `playwright-report/` — **cite these paths in your
  report; they beat prose.**
- `playwright.config.deployed.ts` / `playwright.config.prod-with-base.ts` hit the
  deployed app (absolute URLs, no webServer). Use for production smoke sweeps.

### Don't

- Don't delete a failing parity spec to make the suite green — a red parity spec is a
  *finding*. `.skip` with a comment only if the user has accepted it.
- Don't write into `e2e/` root or edit `e2e/obsidian-parity.md` unless the user asks —
  graduation and the scenario doc are human decisions.
- Don't add dependencies; Playwright is enough.
- Don't `git commit`/`git push` from the qa-tester subagent.

---

## Part 3 — Live GitHub-sync harness

`src/__tests__/e2eSyncLive.test.ts`, run with `npm run e2e:sync`
(`scripts/run-e2e-sync.js`). It does a real clone/push/pull round-trip against a test
repo, so it needs `GITHUB_TEST_TOKEN` in `~/.config/noteser/test-token.env` (the runner
reads it from the file and passes it via env — the token is never printed or put on the
command line). **Touch this only when you change sync logic.** It is excluded from the
default `npm test` loop and never runs in CI.

---

## Part 4 — Manual QA

`docs/feature-test-checklist.md` is the living, human walk-through checklist grouped by
feature area. Use it for end-to-end manual passes after a sizeable change. Test in both
Firefox and Chrome — sync drift, IndexedDB behavior, and emoji input differ between
engines. After any change to `settingsStore` defaults, existing users keep their
persisted value — use `?reset=1` to see the new default.

---

## The rules (both layers)

1. **Pick the cheapest layer that proves it.** Unit first; reach for Playwright only
   when you genuinely need the real DOM, CodeMirror, or a full user flow.
2. **Mock only at boundaries** — `fetch`, `idb-keyval`/IndexedDB, GitHub, time. Run real
   code everywhere else. Never mock the unit under test.
3. **Isolate every test.** Reset stores in `beforeEach` (`setState` for Jest;
   `setupCleanVault` for Playwright). No cross-test order dependence.
4. **Wait for hydration** before reading persisted state (`waitForTestHooks` in E2E;
   `persist.hasHydrated` spy in unit).
5. **No bare `waitForTimeout` / sleeps.** Use `expect.toPass`, web-first assertions, or a
   store-state assertion.
6. **Seed through the store API**, not by clicking through the whole UI.
7. **Locators: `getByTestId` > `getByRole` > `getByText` > CSS.** Add a `data-testid`
   rather than writing a brittle selector.
8. **A failing test is a finding, not a chore to hide.** Don't delete or weaken it to go
   green; surface it.
9. **No snapshot tests** except small pure data structures. No new dependencies without
   flagging. A `build` is not a test.
10. **Run the local gate before pushing:** lint → typecheck → `npm test` → build. End
    every test run by reporting what you added/changed, the pass/fail count, and anything
    you could not cover and why.
