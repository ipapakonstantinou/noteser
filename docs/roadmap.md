# Roadmap

Loosely prioritized — top section is what's being picked up next, bottom is
"someday / nice to have." The agent orchestrator queue
(`.claude/orchestrator/queue.json`) holds the *active* work; this file is the
wider backlog.

Last refresh: 2026-05-20.

> Latest sweep: AI commit messages, daily-note streak counter, and the
> SidebarStack module split (per-file components for the pinned-group
> machinery) all landed this morning.

## In flight

_Nothing right now — promote from Next when starting work._

## Next

- **gi9n Settings UI.** The vault `.gitignore` is parsed + respected today,
  but there's no in-app editor for it — users have to round-trip through
  GitHub or another editor. Settings → Sync gains a textarea that reads the
  remote file on demand, lets the user edit, and uploads on the next sync.
  Local-only overlay via `.noteser/ignore.local` for per-device extras.
- **vs8x conflict UI.** Vault settings sync is last-writer-wins today; key-
  by-key merge tab (like notes have) when both sides drifted since the
  last sync. Lists every differing key with take-local / take-remote /
  keep-both radios.
- **Share without account v2.** The `/share` page already works (notes
  encoded into a URL fragment, no backend). Add: expiry timestamp baked
  into the payload, optional burn-after-read flag (recipient-side flip),
  view counter (originating-browser-side counts re-decodes), and a
  Settings → Share group with default expiry / burn-on-share toggles.
- **Custom theme editor.** Settings → Appearance with a color-picker grid
  wired to CSS variables on `:root`. `themeOverrides: Record<token,
  hexString>` in settingsStore; Tailwind theme reads from CSS vars so
  overrides apply live. Preset themes (light / sepia / solarized-dark)
  as starting points. Reset-to-default button.
- **Sync robustness.** Very large vaults (>5k notes), explicit rate-limit
  handling on the GitHub Git Data API, partial-failure recovery for
  multi-blob pushes that 502 halfway through, polished conflict-resolution
  UX for bulk drift after long offline edits.

## Later

- **Mobile browser version.** Responsive layout for phones / small tablets
  — collapsible sidebar by default, touch-friendly tab bar, single-pane
  mode below a width threshold, virtual-keyboard-safe editor.
- **Security hardening.** Token storage review (currently localStorage —
  fine for personal tool, not for multi-tenant), XSS surface in rendered
  markdown, tighter auth on the `/api/github/*` proxy routes, CSP review.
- **Live collaboration.** `useCollaboration` already has Yjs WS plumbing
  (opt-in via `NEXT_PUBLIC_YJS_WS_URL`); needs a UI to invite collaborators,
  show remote cursors, and surface presence in the editor footer.
- **Export to PDF.** The export pipeline (`src/utils/export.ts`) handles
  markdown / JSON / HTML / ZIP via `file-saver` + `jszip`. PDF is the
  obvious missing format — would need a print-stylesheet or a client-side
  PDF library.
- **Weekly review template.** Periodic-note feature — a template that
  scrapes the week's notes for tasks + tags and stitches a Sunday-night
  summary. (Streak counter shipped; weekly review still pending.)
- **Backup encryption.** Optional passphrase-protected blob encryption
  before push so the GitHub repo can stay public-safe.

## Recently shipped (2026-05-19 → 2026-05-20)

A lot landed in the last 48h. Highlights:

- **Sidebar redesign (s4r3).** Obsidian-style stacked pane model — Calendar
  / Files / Outline / Source Control / Search / Bookmarks / Related as
  draggable tab icons, drag-up to pin, drag-down to unpin. Scrollable
  pinned area with no group limit; per-pinned-panel mini tab strips;
  multi-panel pinned groups; bigger drop zones during drag.
- **Sync polish.** Vault settings sync via `.noteser/settings.json`
  (vs8x), vault-level `.gitignore` support (gi9n), folder tombstones so
  deleted hidden folders don't re-derive, folder-delete cascade to
  contained notes, drop-to-root fix.
- **VS Code-style Source Control panel** (vscg) — top action toolbar,
  commit-message textarea with `{{date}}` template, collapsible CHANGES
  group, folder-tree grouping with A/M/D badges.
- **Editor gutter diff** — green "added" / yellow "modified" bars next
  to changed lines since the last successful push.
- **AI.** Per-note actions (Summarize / Extract tasks / Suggest tags /
  Rewrite for clarity / Translate) via Anthropic or OpenAI; embeddings +
  Related notes panel (a1f7) with auto re-index on save (phase B) and
  semantic-search mode in Ctrl+K (phase C).
- **`.trash` folder.** Replaces the standalone Trash view; deleted
  notes appear as a synthetic top-of-tree folder, behave like normal
  rows.
- **Drag-and-drop.** Folder drag-into-folder, ribbon de-dup, right-click
  pin/unpin on sidebar tabs, drop-between-rows reorder cancelled per
  user feedback.
- **Delete UX.** Enter / Delete confirm in DeleteConfirmModal; folder
  delete cascades to notes (soft or hard per trashMode).
- **Test coverage.** 67 suites / 1053+ tests green; ~200 added today.
