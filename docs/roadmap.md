# Roadmap

Loosely prioritized — top section is what's being picked up next, bottom is
"someday / nice to have." The agent orchestrator queue
(`.claude/orchestrator/queue.json`) holds the *active* work; this file is the
wider backlog.

Last refresh: 2026-05-21.

> A LOT shipped between 2026-05-19 and 2026-05-21. Highlights: full
> branch-per-feature deploy workflow, Welcome tab replacing the
> onboarding modal, Feature tour seed with bundled screenshots,
> parallel-QA infrastructure (35 new parity specs), three QA-found
> bug fixes, sidebar polish (resize handles, intra-strip reorder),
> Settings → Editor preview-mode default, the noteser favicon, AI
> commit messages, daily streak, weekly review, PDF export.

## In flight

_Nothing right now — promote from Next when starting work._

## Next

- **Sync robustness.** Very large vaults (>5k notes), explicit rate-limit
  handling on the GitHub Git Data API, partial-failure recovery for
  multi-blob pushes that 502 halfway through, polished conflict-resolution
  UX for bulk drift after long offline edits.
- **Mobile / responsive layout.** Collapsible sidebar by default, touch-
  friendly tab bar, single-pane mode below a width threshold, virtual-
  keyboard-safe editor. The current layout assumes ≥1024px wide.
- **Backup encryption.** Optional passphrase-protected blob encryption
  before push so the GitHub repo can stay public-safe.

## Parity gaps documented but not fixed

Surfaced by the qa-tester subagent's two parity sweeps (23 + 17 specs).
Each one currently passes by asserting the existing (non-Obsidian)
behaviour — flipping any of these is a small, scoped commit:

- **Ctrl+W** doesn't close the active tab (Obsidian binding). × button works.
- **Ctrl+,** doesn't open Settings (Obsidian binding). Command palette works.
- **Double-clicking** a note row doesn't trigger inline rename. Context-
  menu → Rename works.
- **Right-clicking a deleted note** doesn't show "Restore" — only the
  dedicated Trash view has that.
- `splitTabRight` removes the empty left pane on the only-tab split.
  Obsidian keeps the empty pane visible.
- The `Modal` component lacks `role="dialog"` — small a11y gap; screen
  readers don't announce noteser modals as dialogs.

## User feedback pending clarification

- **"Weird icon-click behavior"** — reported via Telegram, needs a
  screenshot or screen recording to reproduce. Suspected: top mini-strip
  icon click causes layout shift or activates wrong panel.
- **"Hide/show panels"** — proposed feature: collapse a pinned panel
  to just its mini-strip header (icon stays visible, content hides),
  click again to expand. Awaiting interpretation confirmation.

## Later

- **Security hardening.** Token storage review (currently localStorage —
  fine for personal tool, not for multi-tenant), XSS surface in rendered
  markdown (mostly addressed via the urlTransform fix and the static-
  source XSS guards), tighter auth on the `/api/github/*` proxy routes,
  CSP review.
- **Live collaboration.** `useCollaboration` already has Yjs WS plumbing
  (opt-in via `NEXT_PUBLIC_YJS_WS_URL`); needs a UI to invite collaborators,
  show remote cursors, and surface presence in the editor footer.
- **Native apple-touch-icon PNG.** SVG isn't accepted by Next.js for
  the apple-icon convention; generate a 180×180 PNG from `icon.svg`
  if anyone actually adds noteser to their iOS home screen.

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
