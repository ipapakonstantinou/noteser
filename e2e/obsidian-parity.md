# Obsidian parity scenarios

This file is the **source of truth** for what "Obsidian-like behavior" means
in noteser. Each scenario describes a user-facing flow the way an Obsidian
power-user would expect it to work. The `qa-tester` subagent reads this doc
and writes Playwright specs under `e2e/parity/` to verify each one.

Conventions:

- Scenarios are written **for the agent, not for a human regression list** —
  prose, not Gherkin. The agent's job is to figure out the testid + the
  click path.
- Each scenario starts with **"Obsidian behavior:"** (the baseline we're
  matching) and **"Noteser today:"** (what should be true now). If those
  don't agree, the scenario is the gap — the agent should still write the
  spec, expect it to fail, and report the divergence.
- Scenarios are grouped by area. Keep them short. If a scenario grows past
  ~10 lines, split it.

---

## File pane (sidebar tree)

### create-note-via-button

**Obsidian behavior:** Clicking the "new note" button creates an untitled
note in the current folder, opens it in the editor, and puts the cursor in
the title.

**Noteser today:** Same flow — new-note button in the sidebar header or via
`Alt+N` shortcut. New note title is editable inline.

### rename-note-inline

**Obsidian behavior:** Double-click a note title in the sidebar → it becomes
editable in place. Enter commits, Escape cancels. Click outside also commits.

**Noteser today:** Rename is triggered via context-menu → Rename, not
double-click (this was a deliberate decision — see CLAUDE.md). Verify the
context-menu path works; **flag as parity gap** that double-click doesn't
trigger rename.

### drag-note-into-folder

**Obsidian behavior:** Drag a note row onto a folder row → note moves into
that folder. Drop on empty space = move to root.

**Noteser today:** Same. Drop into hidden folders (`.noteser/`) should also
work (no special-casing).

### create-folder-and-nest

**Obsidian behavior:** New folder via context-menu; can be nested arbitrarily;
expanded/collapsed state survives reload.

**Noteser today:** Same. Expanded state lives in `useFolderStore.expandedFolders`
and persists.

### delete-note-confirms

**Obsidian behavior:** Delete from context-menu → confirmation modal → on
confirm note moves to trash. Enter/Delete keys both confirm.

**Noteser today:** Same. The `DeleteConfirmModal` accepts both Enter and
Delete to confirm.

### trash-folder-shows-deleted

**Obsidian behavior:** Trashed notes appear in a `.trash` folder at the
top of the tree; they look like normal rows; right-click → Restore.

**Noteser today:** Same. The `.trash` folder is synthetic — derived from
`isDeleted: true` notes.

---

## Tabs / panes

### single-click-preview-double-click-pin

**Obsidian behavior:** Single-click a note in the sidebar opens a "preview"
tab (italic title) that gets replaced if you click another note. Double-click
pins the tab so subsequent clicks open new tabs.

**Noteser today:** Same. Typing into a preview tab auto-promotes it to a
pinned tab.

### drag-tab-to-split-right

**Obsidian behavior:** Drag a tab to the right edge of the editor area →
splits horizontally into two panes with that tab in the new pane.

**Noteser today:** Same. Max two horizontal panes.

### close-tab-keyboard

**Obsidian behavior:** `Ctrl+W` closes the active tab. Closing the last tab
in a pane closes the pane (unless it's the only pane).

**Noteser today:** Verify shortcut works.

### tab-reorder-drag

**Obsidian behavior:** Drag a tab left/right within the tab bar to reorder.

**Noteser today:** Should work. May be flaky with HTML5 dnd — see agent
notes about `dispatchEvent` fallback.

---

## Sidebar panels (the icon strip)

### pin-tab-to-top

**Obsidian behavior:** Right-click an icon in the bottom tab strip → "pin to
top" creates a new pinned panel above. Drag-up to the same drop zone does
the same.

**Noteser today:** Same. Pinned panels live as their own mini-strips with
optional headers; "drag from main strip to top zone" should work.

### multi-panel-pinned-group

**Obsidian behavior:** Dragging an icon onto an existing pinned mini-strip
adds it to that group (the strip becomes multi-icon).

**Noteser today:** Same. Group composition is `string[][]` in
`useSettingsStore.pinnedPanels`.

### scrollable-pinned-area

**Obsidian behavior:** With many pinned groups, the pinned area scrolls
internally; the main tab strip stays reachable at the bottom.

**Noteser today:** Same — `max-h-[60%]` cap on the pinned area, internal
scroll.

---

## Editor (markdown + live preview)

### live-preview-headings

**Obsidian behavior:** Type `# heading` and the `#` shrinks/styles as a
heading while you're on that line; rendered as plain `<h1>` when cursor
leaves.

**Noteser today:** Same — `markdownLivePreview.ts` CodeMirror extension
handles this.

### live-preview-tags

**Obsidian behavior:** `#tag` patterns inline get styled as pills both in
edit mode and rendered mode.

**Noteser today:** Same — `.cm-lp-tag` in edit mode, `.preview-tag` in
rendered mode.

### wikilinks-render-and-click

**Obsidian behavior:** `[[Note Name]]` renders as a clickable link in the
preview; clicking opens that note (or creates a new one if missing).

**Noteser today:** Same. Verify both the render and the click-to-open behavior.

### tasks-toggle-shortcut

**Obsidian behavior:** With cursor on a `- [ ] ...` line, `Ctrl+L` (or
similar) toggles to `- [x]` and back.

**Noteser today:** Same — `Alt+Shift+L` is the shortcut (see CLAUDE.md and
the relevant commit history).

### code-fence-syntax-highlight

**Obsidian behavior:** Triple-backtick code fences with a language tag
render with syntax highlighting in preview.

**Noteser today:** Same — uses refractor/prismjs via remark.

---

## Search

### ctrl-k-quick-switcher

**Obsidian behavior:** `Ctrl+K` opens the quick switcher; arrow keys move
selection; Enter opens the selected note.

**Noteser today:** Same — `SearchModal` with Fuse.js index. Also has a
semantic-search mode toggle (gated on embeddings).

---

## Sync

### connect-and-pull

**Obsidian behavior (Obsidian Git plugin):** Configure repo, pull → notes
arrive in the sidebar tree.

**Noteser today:** Same flow via GitHub OAuth device flow + the `GitHubRepoModal`.
This scenario will likely be **skipped** by the agent without test credentials
— if so, note that and don't fail the suite.

### gitignore-editor

**Obsidian behavior:** N/A (Obsidian doesn't have this) — this is a
noteser-specific feature.

**Noteser today:** Settings → Sync → Vault .gitignore. "Fetch from sync repo"
populates the textarea. Edit shows "Will push on next sync" badge. Discard
reverts to snapshot. Skip if no sync repo connected.

---

## Settings & theming

### settings-open-via-shortcut

**Obsidian behavior:** `Ctrl+,` opens settings.

**Noteser today:** Same.

### theme-token-edits-apply-live

**Obsidian behavior (themes plugin):** Edit a color token → UI reflects
the change immediately, no reload.

**Noteser today:** Same — `themeOverrides` writes to `:root` CSS variables;
Tailwind reads via `var(--obsidian-*, fallback)`.

---

## Templates

### weekly-review-template

**Obsidian behavior:** Templates plugin can have a "weekly review" template
that includes the past week's notes.

**Noteser today:** Built-in. Templates modal → "Weekly Review" → creates a
note with auto-aggregated open tasks, done tasks, top tags from the last
7 days.

### daily-streak-chip

**Obsidian behavior:** N/A (third-party plugin).

**Noteser today:** EditorFooter shows a 🔥 streak chip when consecutive
daily-notes exist for ≥ 2 days. Verify the chip renders when conditions are met.

---

## Suggested ordering

Start with the cheapest, highest-signal scenarios:

1. `create-note-via-button` — catches "did anything break in the basic loop"
2. `live-preview-headings` — catches editor regressions
3. `ctrl-k-quick-switcher` — catches search regressions
4. `pin-tab-to-top` — catches sidebar regressions (which churn a lot)
5. `delete-note-confirms` — catches modal regressions
6. `theme-token-edits-apply-live` — catches CSS-variable regressions

Then work through the rest as time permits. Skip sync scenarios unless
the user provided credentials.
