# Roadmap

Loosely prioritized — top section is what's being picked up next, bottom is
"someday / nice to have." The agent orchestrator queue
(`.claude/orchestrator/queue.json`) holds the *active* work; this file is the
wider backlog.

Last refresh: 2026-05-30 (evening, post-launch tranche).

> Everything below "Recently shipped (2026-05-25 → 2026-05-30)" is now
> in prod at noteser.app (main `48b53b5`).

## In flight

_Nothing right now._

## Next (genuinely upcoming)

- **Email signup** (#16 in task list) — Jon picked Buttondown 2026-05-30.
  Blocked on Jon creating the Buttondown account + sharing the API key.
  Will compound with Reddit / HN traffic.
- **Sponsor / tip-jar links** (#24) — blocked on you creating GitHub
  Sponsors + Ko-fi accounts. (Note: Stripe donations are already live
  per separate project memory.)
- **Native wrap via Tauri** (#26) — multi-week scope, NOW MORE INTERESTING
  after the 2026-05-30 mobile-keyboard saga: the iOS Safari input-
  accessory pill cannot be hidden from a web app, so a native wrap is
  the only path to an Obsidian-style keyboard-flush experience. Bonus:
  closes the keyboard-PWA pain Jon hit on his iPhone.
- **Live collaboration — Phase B/C.** Add yjs + y-websocket deps; bind
  a `Y.Doc` per note; integrate y-codemirror.next for remote cursors.
  Phase A (presence + WebSocket probe) is already in prod.
- **Security audit follow-ups** (older, still open, medium severity):
  - Finding 2: OAuth scope — needs user input on `repo` →
    `public_repo` / fine-grained PAT trade-off.
  - Finding 3: in-memory rate limiter on serverless — needs Vercel KV
    or Upstash dep.
  - Finding 4: XFF spoofing on non-Vercel deployments — env-var-
    controlled trust depth.
  - Finding 6: nonce-based `script-src` — Next.js middleware
    investigation.
- **OPTIONS preflight tightening on git-proxy** — defence-in-depth
  follow-up from the 2026-05-30 git-proxy security fix (see SECURITY.md
  audit log). Echo only allowed origins rather than `*`. Low priority;
  the actual handler is already guarded.
- **ESLint rule migration off `next lint`** — the noteser repo is on
  flat-config via FlatCompat, but `next/core-web-vitals` silently drops
  custom rule blocks in that wrapping (verified 2026-05-30 trying to
  add an XSS-sink ban). A hand-written `eslint.config.mjs` without the
  next preset would let real lint rules land. ~1h scope.

## User feedback pending clarification

- **"Weird icon-click behavior"** — reported via Telegram, needs a
  screenshot or screen recording to reproduce.
- **"Pull doesn't give a conflict"** — reported 2026-05-23. Classifier
  probes (6 edge-case tests) all pass; need a repro scenario to dig
  into the apply step.

## Later

- **Reduce Vercel egress on first-clone** (flagged 2026-05-24) — the
  initial vault clone streams the whole-repo zipball through the
  `/api/github/zipball` Vercel proxy, which counts against the free
  tier's "Fast Origin Transfer" (10 GB/mo). Fine for personal use, but
  it is the main Vercel bandwidth cost as usage grows. Options: let the
  browser fetch the zipball directly from `codeload.github.com` if CORS
  allows (drops the proxy hop entirely), or fall back to an incremental
  tree+blob clone, or cache. Context: a "50% Fast Origin Transfer"
  warning fired this date, mostly from a since-fixed re-clone-on-every-
  reload bug, but the proxy egress is the real long-term scaling item.
- **Real-time editing (collab Phase B-D)** once Phase A lands and a
  Yjs server is available.
- **Tab navigation inside markdown tables** (insert helper shipped
  2026-05-23; navigation between cells is the follow-up).

## Recently shipped (2026-05-25 → 2026-05-30)

Six days of post-roadmap-refresh work, in approximate order.

### Launch tranche (2026-05-30)

The whole-day Saturday push tied to the first r/ObsidianMD launch post:

- **Five welcome-page demo GIFs** under the hero (connect flow + git
  interface + calendar + tasks query + iPhone layout). All recorded
  via Playwright against live noteser.app with `__noteser_test.stores`
  setState seeds, then ffmpeg webm → GIF with `crop=1280:720:0:0`
  before scale (kills the bottom-80px grey strip Playwright records
  but noteser does not paint).
- **Hero rebrand** to "Your second brain in the browser, synced to
  GitHub..." while keeping the "Coming from Obsidian?" CTA below the
  hero (Jon reverted my over-rebrand on this section).
- **Feature-tour attachments self-heal** in `AttachmentImage`. If the
  bundled `<attachmentsFolder>/feature-tour/<bundled.png>` is missing
  from IDB (fresh device, post-reset, never clicked the welcome card),
  the renderer now re-fetches the public asset, paints it, and writes
  it back to IDB for the next paint.
- **Mobile keyboard journey.** Built a `useKeyboardInset` VisualViewport
  hook + Obsidian-parity pill toolbar (undo / redo / [[wikilink]] /
  template / #tag / attach / H / B + dismiss). Iterated twice trying
  to clear the iOS Safari input-accessory pill, then REMOVED the bar
  entirely on Jon's call — the iOS pill cannot be hidden from a web
  app, so stacking our own on top was strictly worse. Component file
  retained at `src/components/editor/MobileFormattingToolbar.tsx` for a
  future native wrap (see Tauri item above).
- **Chrome autofill suppression.** `autocomplete="off"` on the CM
  contenteditable — kills Chrome Android's "key / card / pin / ✓"
  autofill row that was overlaying the bottom of the page.
- **Vault change-passphrase flow.** Three-commit feature that had
  been sitting on `feat/backup-encryption-phase-b`; merged, tested,
  shipped this day.
- **Gist publish hook-order fix** (one-commit branch `feat/gist-publish`)
  + **zipball lazyload test coverage** + **GitHub sync hardening plan
  doc** all merged and shipped in the same dev → main tranche.
- **Security: git-proxy guards.** External review (received via
  Telegram on 2026-05-30) flagged `/api/git-proxy/[...path]` as the
  only proxy route without `isOriginAllowed` + `checkRateLimit`. Added
  both. Severity bound (per the review): infra-abuse / bandwidth-amp
  risk, not token-theft, not SSRF. See SECURITY.md audit log.
- **markdownXssGuard expanded** to pin direct `.innerHTML =` setter
  assignments (the last unguarded DOM-level raw-HTML sink, alongside
  the existing `dangerouslySetInnerHTML` / `rehype-raw` /
  `rehypePlugins` pins). The ESLint-rule path was attempted first but
  abandoned — FlatCompat + `next/core-web-vitals` silently drops
  custom rule blocks. The test-time guard has the same blast radius.
- **SECURITY.md** gains an append-only Audit log section with entries
  for the git-proxy fix and the static-source expansion.

### Stability + UX polish (2026-05-25 → 2026-05-30)

- **Tab restore on reload** — the previous-session vault opens its
  recent tabs back up. `vaultReady` gate + defense-in-depth guard +
  `reopenTabsOnStartup` settings toggle (default on). Fixed the startup
  race where `pruneStaleTabs` ran before async repo-scoped notes loaded
  and silently dropped the just-restored tabs.
- **Editor autocorrect setting.** Phone keyboards now show predictive
  text + autocorrect on the CodeMirror surface when the user opts in
  via Settings → Editor → "Autocorrect & word suggestions". CM disables
  these by default; the setting toggles them live via a Compartment
  reconfigure.
- **Tooltip system rebuild** (closes Issue #26). The 117 native
  `title=""` flicker / sticky / flash-of-empty-tooltip behaviours on
  icon-only controls were replaced with a single app-root `TooltipLayer`
  scoped to icon-only interactive controls.
- **Keyboard shortcuts batch.** `Ctrl+W` → default `Alt+W` for close-tab
  (browsers eat the Ctrl+W). `Ctrl+D` deletes the current line (was
  bookmark before). Enter on an empty `- [ ] ` checkbox exits the list
  (Obsidian style), Enter on a non-empty checkbox carries the `- [ ]`
  prefix with a space ready for the next item.
- **Double-reload on first SW install** fixed. `clients.claim()` was
  firing `controllerchange` on first-install, which `PwaProvider`
  interpreted as a service-worker update takeover and reloaded the page
  — once on install, once on intended startup. New
  `shouldReloadOnControllerChange(alreadyReloaded, isUpdateTakeover)`
  predicate distinguishes.
- **Flaky CI fix.** `largeVaultPerf.test.ts` "warm faster than cold"
  was failing intermittently on main, passing on dev for the same
  commit. Replaced wall-clock ratio assertions with deterministic
  array-reference identity checks. 8 tests still pass.
- **Repo hygiene pass.** 92 merged-into-main branches deleted in one
  sweep. Eight remained after; six of those were resurrected /
  finished / deleted on 2026-05-30, leaving just `dev` and `main`.

## Recently shipped (2026-05-22 → 2026-05-23)

Two-day stretch of small features + polish, plus the domain migration.

### Domain + infra (2026-05-23)
- **noteser.app domain** — added to Vercel, SSL issued, prod traffic
  serving. Old `noteser.thetechjon.com` 308-redirects to it (will be
  removed in the near future). Code refs updated across README +
  playwright configs.
- **uuid 10 → 11.1.1 bump** — closes Dependabot #77
  (GHSA-w5hq-g745-h8pq). No call-site changes needed.

### Editor power features (2026-05-23)
- **Per-line revert in editor gutter** — click a green ("added") or
  yellow ("modified") gutter bar to revert that hunk to the last-
  pushed remote. Single transaction → Ctrl+Z restores. Also surfaced
  a latent bug: a leftover `.cm-gutters: display: none` rule was
  hiding the gutter entirely.
- **Find / replace panel** — wires `@codemirror/search` with Ctrl+F
  (find) + Ctrl+H (replace, Obsidian convention). Panel themed to
  the Obsidian palette.
- **Tag autocomplete on `#`** — typing `#` opens a usage-ranked
  dropdown of every tag in the vault. ↑↓/Enter/Tab/Esc behave like
  the existing wikilink popup. Mid-word `#` (e.g. `foo#bar`) is
  correctly suppressed.
- **Markdown table insert** — `Ctrl+Alt+T` drops a 2×2 GFM table
  with "Header 1" pre-selected for immediate overtype.

### Mobile (2026-05-23)
- **Edge-swipe drawer** — right-swipe from the left 24px opens the
  sidebar; left-swipe ≥50px closes. Mostly-vertical motion (scroll
  gesture) is ignored. Pure decision logic in `src/utils/edgeSwipe.ts`.
- **Mobile formatting toolbar** — 5-button strip below the editor:
  Bold / Italic / Heading / Bullet / Task. Each toggles its
  formatting on the current selection or line. Hidden in preview mode.
- **Mobile drawer panel switcher** (2026-05-23) — drawer now renders
  the full SidebarStack so Calendar / Source Control / etc. are
  reachable on phones.

### UX polish (2026-05-22 → 23)
- **Discard local changes** — toolbar button in the Source Control
  panel; two-step modal with "also drop unpushed" toggle. Uses the
  existing `resetToRemote` util.
- **Empty-state CTAs** — pane with no active tab shows "Open today's
  daily note" + "New note" buttons.
- **Avatar `<img>` empty-src guard** — Sidebar + GitHubView now skip
  the avatar when `avatar_url` is empty, eliminating a React warning
  that fired during the revert-to-commit modal lifecycle.

### Docs (2026-05-23)
- **/help expanded** — two new pages (`/help/editor`, `/help/mobile`)
  covering every feature shipped in this stretch. Existing pages got
  shortcut rows for Ctrl+F / Ctrl+H / Ctrl+Alt+T. README's keyboard
  table mirrors.
- **Help-route parity spec** updated for 7 pages + noteser.app URL.

### Test infrastructure (2026-05-23)
- **8 new parity specs** for the overnight batch + this stretch:
  per-line revert, mobile swipe, search/replace, mobile formatting
  toolbar, empty-state CTAs, tag autocomplete, markdown table insert,
  console-error monitor.
- **6 pull-conflict probe tests** added to `githubSyncClassify.test.ts`
  covering delete-vs-modify, modify-vs-delete, consecutive non-
  overlapping edits, different-content same-position inserts,
  ancestor-fetch failure, identical-content with drifted ancestor.
  All pass — classifier is sound.
- **1418 jest tests passing** across 109 suites (was 1380 before
  this stretch).

## Recently shipped (2026-05-19 → 2026-05-21)

A lot landed across these three days — grouped by area.

### First-run + onboarding (2026-05-21)
- **Welcome tab** replacing the old OnboardingModal popup. VS Code-
  style hero card + Start grid + starter-vault chooser + Learn section.
  Closes via the tab × and flips `onboardingShown` so it doesn't reopen.
- **Feature tour seed** — bundles 9 screenshots in `public/feature-
  tour/`, copies them into the user's vault as attachments under
  `Files/feature-tour/`, creates a `Feature tour.md` note at vault
  root with inline image refs. Idempotent + heals stale state from
  earlier seed versions. ~1-2s on first click.
- **"Show welcome tab"** button in Settings → General so users can
  re-find the tour after dismissing it. Pairs with a "Coming back to
  this tour" section appended to the seeded note.
- **noteser favicon** — replaced the default Vercel triangle with a
  purple "N" monogram on a dark rounded square. Auto-discovered via
  `src/app/icon.svg`.

### Sidebar UX (2026-05-21)
- **Pin-to-top bar removed** per user feedback (vertical noise, could
  get stuck visible).
- **Resize handles visible** — bumped from h-1 (4px, invisible) to h-2
  with a pill indicator at rest. Drag the line between any two stacked
  panels to redistribute height.
- **Right-click bubble fix** — right-clicking a folder no longer unpins
  the surrounding panel (PinnedGroup was leaking its `onHeaderContextMenu`
  into SidebarSection's content wrapper when `hideHeader=true`).
- **Intra-strip drag-reorder** — drag an icon left/right within a
  pinned mini-strip to reorder; insertion line shown at drop target.
- **`dragActive` cleanup** — defensive `mouseup` + `blur` listeners
  so the drag state can't get stuck visible after an external dragend.

### Obsidian-parity polish batch (2026-05-21)
6 small flippable gaps closed in one feat branch — first run of the
new branch-per-feature workflow with preview smoke + dev → main
promotion.

- **Ctrl+W** closes the active tab (data-driven shortcut).
- **Ctrl+,** opens Settings (data-driven shortcut).
- **`role="dialog"` + `aria-modal`** added to the shared Modal —
  screen readers now announce all noteser modals correctly.
- **Restore** option appears in the right-click context menu on a
  deleted note (above the standard items).
- **Double-click on a note row** triggers inline rename via
  `uiStore.requestRename` (was opening pinned, which is now
  exclusive to right-click → Pin / auto-promote-on-typing).
- **`splitTabRight`** keeps the empty left pane visible after
  splitting the only tab (Obsidian behaviour).

### QA-found bug fixes (2026-05-21)
- **Wikilinks broken in preview** — react-markdown v10's
  `defaultUrlTransform` was stripping `wikilink://` URLs. Added a
  pass-through `urlTransform` so WikilinkAnchor receives the right href.
- **Alt+Shift+L shadowed by Alt+L** — collapsed two CodeMirror keymap
  entries into one with the documented `shift:` field.
- **`.trash` folder hidden** when vault had zero active notes — added
  `&& deletedNotes.length === 0` to FolderTree's empty-state guard.

### Editor + features (2026-05-20 → 21)
- **AI commit messages** drafted from pending diff (Settings → AI toggle,
  default off).
- **Daily-note streak counter** — 🔥 chip in EditorFooter when there
  are ≥2 consecutive daily notes. Caps at 366.
- **Weekly review template** — auto-aggregates open tasks, done tasks,
  top tags from the last 7 days into a draft review note.
- **PDF export** via the browser print dialog. Single-note HTML export
  also fixed (was silently downgrading to markdown).
- **Open notes in preview mode** setting (Settings → Editor, default ON).
  Fresh tabs land in preview; refocus preserves user's manual toggle.

### Sync polish (2026-05-19 → 21)
- **gi9n Settings UI** — in-app editor for the shared `.gitignore`
  (Settings → Sync) + per-device overlay.
- **vs8x conflict UI** — key-by-key merge tab for vault settings drift.
  Crash fix when a non-conflict modal opens with `data` payload.
- **Custom theme editor** — color-picker grid in Settings → Appearance,
  writes CSS variables on `:root`, vault-synced via `themeOverrides`.
- **Share v2** — expiry timestamp + burn-after-read flag in `/share` URLs.
- **Vault settings sync** (vs8x) via `.noteser/settings.json`.

### Workflow + infra (2026-05-21)
- **Branch-per-feature workflow** activated. `main` = production, `dev`
  = staging preview, `feat/*` and `fix/*` = per-branch previews on push.
  CI runs on push + PR to both main and dev. Branch protection on main
  is convention-only (GitHub Pro needed for private-repo enforcement).
- **Vercel API token integration** — `.claude/vercel.env` (gitignored)
  + memory note for fetching real preview URLs.
- **Parallel-QA infrastructure** — 3 qa-tester agents run concurrently
  in git worktrees against the deployed app. 35 new parity specs in
  one batch (welcome flow, preview-mode, settings UI).
- **`playwright.config.deployed.ts`** — drops the `webServer` block so
  any parity spec can run against production / preview URLs directly.

### Sidebar redesign (2026-05-19 → 20)
- **s4r3 stacked pane model** — Calendar / Files / Outline / Source
  Control / Search / Bookmarks / Related as draggable tab icons,
  drag-up to pin, drag-down to unpin. Scrollable pinned area with no
  group limit; per-pinned-panel mini tab strips; multi-panel pinned
  groups; bigger drop zones during drag.
- **VS Code-style Source Control panel (vscg)** — top action toolbar,
  commit-message textarea with `{{date}}`, collapsible CHANGES tree
  with A/M/D badges.
- **Editor gutter diff** — green "added" / yellow "modified" bars next
  to changed lines since the last successful push.
- **`.trash` folder** synthetic row at the top of the tree; deleted
  notes look like normal rows.

### Test coverage growth
- **79 jest suites / 1147 passing tests** + **~50 Playwright parity
  specs** across `e2e/parity/` (welcome flow, preview-mode, settings
  UI, sidebar interactions, editor, sync, templates).
- Custom **qa-tester subagent** (`.claude/agents/qa-tester.md`) drives
  Playwright through Obsidian-parity scenarios defined in
  `e2e/obsidian-parity.md`.
