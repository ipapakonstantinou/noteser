# Testing best practices for noteser

> Audience: anyone (human or agent) writing or running tests against
> noteser. Goal: cover as much real behaviour as possible without piling
> up slow, flaky, or low-signal tests. Last refreshed: 2026-06-06.

Noteser is a single-page Next.js 15 / React 19 app whose "backend" is a
GitHub repo of `.md` files. The risk surface is therefore unusual: most
bugs are not server bugs, they are **state, sync, and rendering** bugs
that only show up across reloads, across devices, or against a real Git
history. The test strategy is built around that.

---

## 1. The layers we have, and what each is for

| Layer | Tool | Command | Use it for |
|---|---|---|---|
| Unit / integration | Jest + Testing Library | `npm test` | Pure logic, store reducers, React component behaviour, static-source security guards |
| Component-DOM | Jest + jsdom | `npm test` | A single component's interaction contract (keyboard, ARIA, callbacks) |
| End-to-end | Playwright | `npm run e2e` | Real browser flows: open note, type, split pane, drag tabs, reload-restore |
| Sync harness | custom node script | `npm run e2e:sync` | Real clone/push/pull/round-trip against a live test repo. **Run for ANY sync change.** |
| Typecheck | tsc | `npm run typecheck` | The cheapest, broadest net. Run first. |
| Lint | ESLint (flat) | `npm run lint` | Style + the XSS-sink bans (`dangerouslySetInnerHTML`, `.innerHTML =`, `rehype-raw`) |

There are ~174 Jest suites (2000+ tests) and a growing Playwright suite
in `e2e/`. The `qa-tester` subagent (`.claude/agents/qa-tester.md`)
drives Playwright through the user-style flows in
`e2e/obsidian-parity.md` and writes specs into `e2e/parity/`.

**Default order when validating a change:** typecheck → lint → unit →
(e2e or sync harness if the change touches those surfaces) → build. The
first three catch ~90% of regressions in seconds.

---

## 2. The test pyramid, noteser-shaped

Write the cheapest test that can fail for the bug you care about.

1. **Most tests are unit/integration (Jest).** Anything expressible as
   "given this input, this pure function / store action / component
   produces that output" belongs here. Fast, deterministic, no browser.
2. **A thinner layer of component-DOM tests** for interaction contracts
   that pure logic can't reach: focus, keyboard handlers, ARIA, drag
   events, portal rendering. See `groupResizeHandle.test.tsx` and
   `sidebarResizeHandle.test.tsx` for the pattern — render the component,
   `fireEvent` the interaction, assert on the emitted callback or the
   store.
3. **A small, deliberate e2e layer.** E2e is for journeys that cross
   component / store / persistence boundaries and only break in a real
   browser: reload-restores-tabs, drag-a-tab-to-split, type-promotes-
   preview-tab, the merge-conflict editor. Keep it small — every e2e
   test is a maintenance and flake liability.
4. **The sync harness is its own pillar.** It is the only thing that
   exercises the real three-way-merge against real Git. Non-negotiable
   for sync changes.

If you can push a test DOWN a layer (e2e → component, component → pure
function) without losing the signal, do it. A `findTableBounds` unit
test is worth more than a Playwright test that types into a table.

---

## 3. Where the bugs actually live — prioritise coverage here

Ranked by historical blast radius (from the project's own incident log):

1. **GitHub sync + three-way merge** (`src/utils/githubSync.ts`,
   `syncApply.ts`, `github.ts`). The churn bugs (filename sanitiser
   stripping `&`/`'`, re-canonicalisation on unedited notes, remote
   renames deleted instead of adopted) all lived here and all reached
   prod. Every change needs `npm run e2e:sync` (15+ scenarios) AND a new
   scenario if it introduces a new edit shape. Test the *classifier*
   (`unchanged`/`remoteCreated`/`remoteUpdated`/`remoteDeleted`/
   `conflict`/`conflictDeleted`) exhaustively with unit tests.
2. **Persistence + hydration races** (`page.tsx` `vaultReady` gate,
   `pruneStaleTabs`, the Zustand `persist` stores). The tab-restore bug
   (pruneStaleTabs ran before async repo-scoped notes loaded and wiped
   the workspace) was a race, not a logic error. Test the *guards*:
   "0 notes ⇒ prune is a no-op", "restore waits for hydration".
3. **CodeMirror editor commands** (`CodeMirrorEditor.tsx` keymap, the
   markdown live-preview, table nav, task toggling). These are
   keyboard-driven and easy to break silently. Cover with component-DOM
   tests on the pure helpers (`markdownTable.ts`, `lineDiff.ts`) plus a
   few e2e keystroke journeys.
4. **Security guards** (markdown render path, HTML export). Already
   pinned by static-source Jest guards AND ESLint rules — keep both. Any
   new raw-HTML sink must be added to neither.
5. **Sidebar group/tab model** (`SidebarStack`, `SidebarGroup`,
   `sidebarGroupActions.ts`, the resize handles, cross-sidebar drag).
   State-heavy, lots of edge cases (empty groups, hidden tabs, collapse
   + resize interaction).

---

## 4. How to write a good test here

- **Test behaviour, not implementation.** Assert on what the user or the
  caller observes (the rendered text, the emitted callback args, the
  store value), not on private internals. A refactor that keeps
  behaviour should keep tests green.
- **Mock `idb-keyval` in store/persistence tests.** The Zustand stores
  persist to IndexedDB; jsdom has none. Every store test starts with:
  ```js
  jest.mock('idb-keyval', () => ({
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  }))
  ```
  and resets store state in `beforeEach` so suites don't bleed.
- **For interaction components**, render, `fireEvent` the real gesture
  (`mouseDown` → `mouseMove` on `window` → `mouseUp`, or `keyDown` with
  the actual `key`), and assert the outcome. Cover the negative paths
  too: right-button mousedown does nothing, an unrelated key is ignored,
  movement after release does not keep firing.
- **Cover the boundaries.** Empty table, header-only table, single
  column, the clamp floor (`MIN_GROUP_HEIGHT`), 0 notes, deleted note,
  a path with `&`/`'`/spaces. Most shipped bugs were boundary cases.
- **Static-source guards are legitimate tests.** When the guarantee is
  "no file in `src/` ever does X" (imports `rehype-raw`, calls
  `convertMarkdownToHTML` without `escapeHTML`), a file-walking Jest test
  is the right tool. See `markdownXssGuard.test.tsx`, `exportXssGuard`.
- **Name the file after the unit** (`<thing>.test.ts[x]`) and open with a
  top-of-file comment explaining *what contract* it locks down and *why*.
  Match the house style in `src/__tests__/`.

---

## 5. Flake discipline — the rules that keep CI trustworthy

The project has been bitten by flaky tests; these are hard-won rules.

- **Never assert on wall-clock timing.** `largeVaultPerf.test.ts` once
  asserted "warm run is 3× faster than cold" and tripped on busy CI
  runners. It was rewritten to assert **array-reference identity** (a
  cache hit returns the *same* array; a recompute mints a new one) — same
  coverage, zero timing noise. If you need to prove "cached", assert
  identity or call-count, not duration.
- **No real network, no real clock, no real IDB** in unit tests. Mock
  `fetch`/`api.github.com`, use fake timers if you must, mock
  `idb-keyval`.
- **Seed deterministic ids in tests.** Random UUIDs make snapshots and
  assertions non-reproducible; the stores use stable string ids for
  defaults so SSR and first client render match — preserve that.
- **e2e is where flake hides.** Prefer Playwright web-first assertions
  (auto-retrying `expect(locator)`), never a bare `waitForTimeout`.
  Drive the app through the real UI (click the empty-state "New note"
  button) rather than injecting state via `__noteser_test` setState,
  which RACES persist-rehydration (note shows but no tab opens).
- **PWA cache gotcha when e2e-testing a built app:** the service worker
  can serve stale assets; `next dev --turbopack` rejects a symlinked
  `node_modules` in a worktree — use `next start` on a prebuilt `.next`
  instead. Pre-set `localStorage['noteser-reset-version']='1'` to
  suppress the cleanup reset modal on a cleared profile.

---

## 6. Coverage strategy — "as much as possible" without bloat

Coverage is a flashlight, not a target. `npm run test:coverage` shows
which lines never execute under test. Use it to *find blind spots*, not
to chase a percentage.

- **Cover every branch of the sync classifier and the merge/diff logic.**
  These are pure and high-risk — there is no excuse for an uncovered
  branch in `githubSync` classification or `lineDiff`.
- **Cover every store action's pre/postcondition**, especially the ones
  with early-return short-circuits (no-op when value unchanged, no-op
  when 0 notes) — those guards are exactly what prevents the race bugs.
- **Cover keyboard maps and ARIA**, not just happy-path mouse. Each
  interactive control should answer: is it focusable? does it announce
  its state? does the keyboard equivalent of every mouse action exist?
- **Do not chase coverage on view-only JSX** (pure presentational markup
  with no logic). A snapshot of static markup is low signal and high
  churn. Spend the budget on logic and interaction instead.
- **When you find a bug, write the failing test first**, then fix. The
  regression test is the durable deliverable; the fix is cheap.

---

## 7. Exploratory / QA-sweep checklist

When the task is "test as much as you can" rather than a specific change,
walk these surfaces and file a failing test (or a written repro) for
anything that misbehaves:

- **Notes & folders:** create, rename (F2 / right-click), move between
  folders (drag), pin, soft-delete → Trash → restore / empty, hard-delete
  mode, nested folders, names with `&`/`'`/spaces/leading dots.
- **Editor:** type in live-preview, headings/bold/lists/tasks, toggle a
  rendered checkbox (updates the note), `[[wikilink]]` autocomplete,
  `#tag` styling, table insert + **Tab/Shift-Tab cell navigation**,
  Alt+W close tab, Ctrl+D delete line, Enter-exits-empty-checkbox.
- **Workspace:** single-click preview tab (italic) → type promotes it,
  double-click pins, drag tab to reorder, drag to create a split,
  cross-pane move, back/forward nav, **reload restores tabs**.
- **Sidebar:** collapse/expand groups, **drag-resize between groups**
  (mouse AND keyboard: focus the separator, ArrowUp/Down, Home/End),
  column width resize, cross-sidebar tab drag (left↔right), calendar /
  files / source-control / outline panels.
- **Sync (against a test repo, never a real vault):** connect, pick repo,
  pull (clean), local edit + push, remote edit + pull (clean merge),
  concurrent edit → conflict opens a merge tab → accept yours/theirs/both
  → re-sync, remote rename adopted not deleted, **zero-churn on a
  fetch/discard of unedited notes**.
- **Cross-device / persistence:** reload mid-session, switch vaults,
  empty-state, fresh profile (reset modal suppressed), mobile drawer.
- **Export/import:** MD / JSON / HTML / ZIP; confirm HTML export escapes
  a `<script>` / `onerror` payload in note content.
- **Security:** confirm no path renders untrusted note content as raw
  HTML; confirm `lint` fails if you plant a sink.

---

## 8. Quick reference

```bash
npm run typecheck        # fastest, broadest — run first
npm run lint             # style + XSS-sink bans
npm test                 # full Jest suite (~2000 tests)
npx jest <file|pattern>  # one suite, e.g. npx jest groupResizeHandle
npm run test:coverage    # find blind spots (not a target)
npm run e2e              # Playwright (needs a dev/built server)
npm run e2e:sync         # REAL clone/push/pull round-trip — for sync changes
npm run build            # last gate before promote
```

Belt-and-suspenders is the house philosophy: the static guards stay even
when an ESLint rule covers the same thing, and the sync harness stays
even though the classifier is unit-tested. Redundant coverage on the
high-blast-radius surfaces is a feature, not waste.
