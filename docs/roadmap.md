# Roadmap

Loosely prioritized — top section is what's being picked up next, bottom is
"someday / nice to have". The agent orchestrator queue
(`.claude/orchestrator/queue.json`) holds the *active* work; this file holds
the wider backlog.

## Now

*Nothing in flight — promote from Next when starting work.*

## Next

- **Auto pull githbu on init.** We need to auto-pull every X time,
  based on the settings and to auto-pull github latest commit on init.
- **Settings panel.** Obsidian-style settings modal — theme, daily-note
  format, default folder, sync preferences.
- **Remappable keyboard shortcuts.** Let users rebind shortcuts from the
  settings panel. Useful both for personal preference and to work around
  browser-reserved combos — Ctrl+N is intercepted for "New Window" so
  noteser uses Alt+N for new note; users should be able to pick their own
  escape hatch.
- **Keyboard-driven navigation.** Move around the sidebar without the
  mouse: arrow keys to traverse the folder tree, Enter to open, Space to
  toggle expand, slash to focus search, jump-to-note shortcut. Should
  feel like Obsidian's command palette + tree navigation.
- **VS Code-style Git UI.** A proper source-control sidebar view:
  modified / added / deleted notes shown pre-push with a real Git icon,
  per-file include/exclude, and a richer conflict push manager. Today
  there's a single "Commit & Sync" button and conflicts open as inline
  merge tabs — workable but blind. A VS Code-like changes panel would let
  the user review the whole push before it goes out.
- **Status bar footer.** Word / character count, sync status, branch
  indicator — parity with Obsidian's footer.
- **Test coverage.** Add tests for sync orchestration (`githubSync.ts`),
  IndexedDB stores, and the merge editor line-diff. Pure utilities are
  now well-covered (tags, lineDiff, tasks, taskQuery, kbd shortcuts,
  FolderTreeToolbar).
- **Sync robustness.** Large vaults, rate-limit handling, partial-failure
  recovery, conflict-resolution UX polish.

## Later

- **Mobile browser version.** Responsive layout for phones / small
  tablets — collapsible sidebar by default, touch-friendly tab bar,
  single-pane mode below a width threshold, virtual-keyboard-safe editor.
- **Security hardening.** Token storage review, XSS surface in rendered
  markdown, tighter auth on the `/api/github/*` proxy routes.
