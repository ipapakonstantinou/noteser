# Roadmap

Loosely prioritized — top section is what's being picked up next, bottom is
"someday / nice to have." The agent orchestrator queue
(`.claude/orchestrator/queue.json`) holds the *active* work; this file is the
wider backlog.

Last refresh: 2026-05-23 (mid-day).

> The 2026-05-21 batch + 2026-05-22 → 23 stretch are all in prod. Domain
> migrated to **noteser.app** (308 redirect from the old URL). See
> "Recently shipped (2026-05-22 → 2026-05-23)" for the latest tranche.

## In flight

_Nothing right now._

## Next (genuinely upcoming)

- **Live collaboration — Phase B/C.** Add yjs + y-websocket deps; bind
  a `Y.Doc` per note; integrate y-codemirror.next for remote cursors.
  Phase A (presence + WebSocket probe) is already in prod.
- **Security audit follow-ups** still open (medium severity):
  - Finding 2: OAuth scope — needs user input on `repo` →
    `public_repo` / fine-grained PAT trade-off.
  - Finding 3: in-memory rate limiter on serverless — needs Vercel KV
    or Upstash dep.
  - Finding 4: XFF spoofing on non-Vercel deployments — env-var-
    controlled trust depth.
  - Finding 6: nonce-based `script-src` — Next.js middleware
    investigation.
- **Email signup** (#16 in task list) — blocked on you picking a
  provider (Buttondown vs Resend) + creating the account.
- **Sponsor / tip-jar links** (#24) — blocked on you creating GitHub
  Sponsors + Ko-fi accounts.
- **Native desktop (Tauri)** (#26) — multi-week scope, not started.

## User feedback pending clarification

- **"Weird icon-click behavior"** — reported via Telegram, needs a
  screenshot or screen recording to reproduce.
- **"Pull doesn't give a conflict"** — reported 2026-05-23. Classifier
  probes (6 edge-case tests) all pass; need a repro scenario to dig
  into the apply step.

## Later

- **Real-time editing (collab Phase B-D)** once Phase A lands and a
  Yjs server is available.
- **Tab navigation inside markdown tables** (insert helper shipped
  2026-05-23; navigation between cells is the follow-up).

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
