# Roadmap

Loosely prioritized — top section is what's being picked up next, bottom is
"someday / nice to have." The agent orchestrator queue
(`.claude/orchestrator/queue.json`) holds the *active* work; this file is the
wider backlog.

Last refresh: 2026-05-21 (post-batch).

> 14 PRs opened in a single batch on 2026-05-21. Every roadmap item in
> the "Next" and "Later" sections got a Phase A shipped or fully closed.
> See "In review" below for the open PRs and "Recently shipped" for the
> earlier work. The user feedback in Telegram added one new item
> (Reset to remote, PR #23, shipped same batch).

## In flight

_Nothing right now — promote from In review once the batch lands._

## In review (open PRs from the 2026-05-21 batch)

Mobile / responsive layout — closed:
- **PR #11** Mobile responsive (dvh heights, single-pane mode, ≥44px touch targets, sidebar drawer, parity smoke at 375×667 + 414×896).

Sync robustness — all four sub-items closed:
- **PR #12** `feat/sync-rate-limit` — typed `GitHubAPIError`, 403 + `x-ratelimit-remaining=0` retries, telemetry layer.
- **PR #17** `feat/sync-partial-failure` — push progress events, per-repo in-tab upload cache so a retry skips re-uploaded blobs.
- **PR #21** `feat/sync-large-vault-perf` — per-note tag WeakMap cache + memoised `getActiveNotes/getDeletedNotes`. Bench: 5k notes warm in <1ms.
- **PR #22** `feat/sync-bulk-drift-ux` — `merge-batch` summary tab (≥3 conflicts) with per-row Mine/Theirs/Merge actions + bulk apply.
- **PR #23** `feat/sync-reset-to-remote` — user-requested "Reset to remote" escape hatch (Settings → GitHub sync). Preserves unpushed local notes by default.

Backup encryption:
- **PR #16** `feat/vault-crypto-module` — PBKDF2-SHA256 → AES-GCM, envelope format with `noteser-encrypted: 1` banner, 18 tests.
- **PR #20** `feat/backup-encryption-integration` — wired into push (maybeEncryptForPush before gitBlobSha) and pull (maybeDecryptFromPull after getBlobContent). `vaultKey.ts` in-memory key holder. **UI is a follow-up.**

Security hardening — audit + 3 fixes:
- **PR #13** `feat/security-audit-2026-05-21` — read-only audit doc (1 high, 3 medium, 4 low).
- **PR #14** `feat/security-html-export-escape` — Finding 1 (high): ZIP HTML export now escapes note bodies. Static-source guard test locks the call shape.
- **PR #18** `feat/security-csp-websocket-scope` — Finding 5 (medium): `wss:/ws:` no longer wildcards; derives origin from `NEXT_PUBLIC_YJS_WS_URL` or omits entirely.
- **PR #19** `feat/security-share-burn-hash` — Finding 8 (low): FNV-1a → SHA-256 truncated to 128 bits.

Live collaboration:
- **PR #24** `feat/collab-presence` — Phase A: WebSocket connectivity probe + EditorFooter "Live" pill. Real Y.Doc + remote cursors are Phase B/C.

Native apple-touch-icon:
- **PR #15** `feat/apple-touch-icon` — 180×180 PNG rasterised from `icon.svg`; Next.js 15 auto-discovers.

## Next (post-merge follow-ups from the batch)

- **Backup encryption — Phase B (UI).** Settings → Sync section: enable toggle, passphrase modal, lock-on-startup prompt, wrong-passphrase recovery. Builds on PR #20.
- **Live collaboration — Phase B/C.** Add yjs + y-websocket deps; bind a `Y.Doc` per note; integrate y-codemirror.next for remote cursors. Builds on PR #24.
- **Security audit follow-ups** still open (medium severity, deferred this batch):
  - Finding 2: OAuth scope — needs user input on `repo` → `public_repo` / fine-grained PAT trade-off.
  - Finding 3: in-memory rate limiter on serverless — needs Vercel KV or Upstash dep.
  - Finding 4: XFF spoofing on non-Vercel deployments — env-var-controlled trust depth.
  - Finding 6: nonce-based `script-src` — Next.js middleware investigation.

## User feedback pending clarification

- **"Weird icon-click behavior"** — reported via Telegram, needs a
  screenshot or screen recording to reproduce. Suspected: top mini-strip
  icon click causes layout shift or activates wrong panel.
- **"Hide/show panels"** — proposed feature: collapse a pinned panel
  to just its mini-strip header (icon stays visible, content hides),
  click again to expand. Awaiting interpretation confirmation.

## Later

- **Real-time editing (collab Phase B-D)** as a single sustained track once Phase A lands and a Yjs server is available.

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
