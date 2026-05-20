# Feature test checklist

Living checklist of every feature shipped to Noteser. Use this for manual QA
when you want to walk through the app end-to-end. Tick a box when you've
verified the feature behaves correctly. Add new entries when new features
ship — keep them grouped by area.

Generated from the orchestrator queue's `done` items, ordered roughly by
ship date. Last updated 2026-05-20.

> Convention: each item ends with the orchestrator ID in parens (e.g. `(a2d9)`)
> so you can cross-reference git log / queue entries.

## Editor & live preview

- [ ] **Alt+L** prepends `- [ ] ` to the current line; toggles off if already present (a1b2)
- [ ] **Alt+Shift+L** in edit mode checks/unchecks the task line, stamps/strips `✅ today` (a1b2)
- [ ] **Alt+Shift+L** in preview mode removes the `- [ ] ` prefix and leaves the body (a1b2)
- [ ] `Ctrl+Shift+7` inserts a numbered list at cursor
- [ ] `Ctrl+Shift+T` inserts a todo at cursor (also opens the Task Edit Modal when on a task line)
- [ ] Image drag-and-drop into the editor uploads to IndexedDB + inserts an `![[]]` link (a2d9)
- [ ] Pasted images get the same treatment as drag-drop (a2d9)
- [ ] Image rendering inline in CodeMirror live-preview (edit view) (e6b1)
- [ ] Bold / italic / strikethrough / code styling renders in live-preview
- [ ] H1–H4 headings get progressively larger text (markdownLivePreview)
- [ ] `#tag` patterns render with the purple tag style
- [ ] `[[wikilinks]]` autocomplete pops up while typing
- [ ] Hover preview on wikilinks (if enabled in settings)
- [ ] Ctrl/Cmd+Click on a wikilink navigates to the linked note
- [ ] Wikilinks resolve against note ALIASES too (b1q5)

## Tasks & queries

- [ ] `- [ ] foo` and `- [x] foo` render as styled checkboxes
- [ ] Clicking the checkbox toggles in source and live-preview
- [ ] **`📅 2026-05-20`** inline due date renders + extracts (v5h7)
- [ ] **`⏳ 2026-05-19`** inline scheduled date (v5h7)
- [ ] **`🛫 2026-05-18`** inline start date (v5h7)
- [ ] **`⏫🔼🔽⏬`** priority markers render + sort correctly (v5h7)
- [ ] **`🔁 every week`** etc. — checking the task creates a NEW open instance ABOVE with dates rolled forward + ✅ stamps the closed line (x7m1)
- [ ] Recurrence works with the U+FE0F variant of 🔁 that macOS/iOS emoji pickers produce
- [ ] **`Ctrl+Shift+T`** on a task line opens the Task Edit Modal (w6l0)
- [ ] Modal lets you edit description, status, due/scheduled/start/done dates, priority, recurrence (w6l0)
- [ ] Recurrence field validates the rule and shows inline error for unrecognized rules (w6l0/x7m1)
- [ ] ` ```tasks ` code fences render as live TaskQueryBlock inline (live preview)
- [ ] Task query: `not done`, `done`, `path includes`, `tag includes`, `priority above/below/is`, `due before/after/on`, `scheduled before/after/on`, `has due`, `no due` (d3s7)
- [ ] Task query: `group by` folder / filename / status / tag / priority (d3s7)
- [ ] Task query: `sort by` due / priority / created / status / title (d3s7)
- [ ] Density (compact vs comfortable) honored in TaskQueryBlock (f1b8)

## Sidebar & navigation

- [ ] Sidebar collapse / expand
- [ ] Folder tree: create folder, rename folder, drag-drop notes between folders
- [ ] Folder tree: keyboard nav — Arrow keys, Home/End, Enter, Space, letter-jump (c4a1)
- [ ] `Ctrl+1` focuses the sidebar folder tree
- [ ] Configurable folder sort: alphabetical / modified / created / manual (e9c4)
- [ ] Show-hidden-folders toggle reveals `.folder` items
- [ ] Calendar view with day picker
- [ ] Tags view (aggregated from `#tag` patterns)
- [ ] Recent view (notes by `updatedAt`)
- [ ] Trash view; configurable trash mode = trash / hardDelete (h8b5)
- [ ] GitHub view: status, repo, last commit, conflicts pending, pull/push buttons (c4f8)
- [ ] Outline view: H1–H6 of the active note, click to jump (c2r6)
- [ ] Backlinks view: every note that links to the active one (y8n2)
- [ ] Reveal-in-tree: clicking a note in Recent/Backlinks scrolls + flashes the row in the folder tree (n6h1)
- [ ] Drag-drop attachments between folders without UI blanking (p8j3)
- [ ] Cascade folder deletion: deleting a folder removes its notes + nested folders + attachments (u4e5)

## Modals

- [ ] Search (Ctrl+K or `/`): fuzzy notes search via Fuse.js
- [ ] Command Palette (Ctrl+Shift+P): fuzzy actions + open-note rows (cp1)
- [ ] Templates picker (f3b8)
- [ ] Settings: theme, daily-note date format, default folder, sync prefs, sort mode, task list density, AI keys, shortcut overrides, trash mode (d8a7, l4f9, t1u2, y9d5)
- [ ] Settings modal scrolls when content overflows (t3d4)
- [ ] Export modal (now also lives inside Settings) (a8d3)
- [ ] Shortcuts modal (Ctrl+/) shows live overrides (t1u2)
- [ ] Configurable shortcut overrides survive a reload (t1u2)
- [ ] Task Edit Modal (described above)

## GitHub sync

- [ ] OAuth device-flow login completes successfully
- [ ] Pick a repo from the list (or create one)
- [ ] First-time clone uses the zipball fast path
- [ ] Subsequent pulls fetch only changed blobs
- [ ] Push uploads only changed blobs (no storm on a stable repo)
- [ ] Trailing-newline drift between Obsidian and Noteser does NOT re-upload every file (normalizeForPush fix)
- [ ] Folder paths with spaces don't double-upload (ensureFolderPath sanitize fix)
- [ ] Conflicts open as inline merge tabs (not modal)
- [ ] Smart 3-way merge resolves non-overlapping conflicts automatically (w7b3)
- [ ] Explicit "Pull only" button works (d5a9)
- [ ] Auto-sync on startup honors the setting (r1a8)
- [ ] Auto-sync interval (custom minutes) fires periodically (r1a8)
- [ ] Binary attachments (images) sync via base64 upload (f7c2)
- [ ] Deleted-attachment tombstones propagate to the remote tree (u4e5)
- [ ] After a wedged session, the sync button still works — global isSyncing flag self-recovers on reload

## Recovery / data

- [ ] `?reset=1` URL flag wipes localStorage + IDB and redirects to `/`
- [ ] `PERSISTED_RESET_VERSION` kill switch triggers wipe + reload on bump (with confirm if unsynced)
- [ ] Custom AI provider settings (OpenAI / Anthropic / Off) persist (y9d5)
- [ ] AI API key field works
- [ ] Daily Notes folder is configurable (e2f1)
- [ ] Templates folder is configurable (f3b8)
- [ ] Attachments folder is configurable (b9e4)
- [ ] System-folder abstraction unifies the three (g7a2)

## Settings UI

- [ ] **Two-pane layout (s9r4)** — category nav on the left, panel on the right
- [ ] Clicking a category swaps the right pane, marks the active row
- [ ] About panel shows version + GitHub link + production URL + "Report a bug" button
- [ ] Beta panel shows the master toggle; flag list appears only when enabled
- [ ] **`?reset=1`** URL works to recover a wedged Firefox profile

## Periodic Notes (p4n5)

- [ ] **Command palette: "Open this week"** — creates `2026-WW` in `Notes/Weekly/`
- [ ] **Command palette: "Open this month"** — creates `2026-MM` in `Notes/Monthly/`
- [ ] Re-running either command in the same week/month opens the existing note (no duplicates)
- [ ] Weekly folder is configurable via Settings (key `weeklyNotesFolder`)
- [ ] Monthly folder is configurable via Settings (key `monthlyNotesFolder`)
- [ ] Date-format tokens `WW`, `W`, `Q` work in any periodic format string

## Bug reporter (b9g2)

- [ ] Settings → About → **"Report a bug"** opens the modal
- [ ] Command palette → **"Report a bug"** opens the modal
- [ ] Form requires title + description before Submit enables
- [ ] **Preview report body** toggle shows the rendered markdown
- [ ] Submit creates an issue on `ipapakonstantinou/noteser` (needs GitHub connected)
- [ ] **Copy to clipboard** fallback works when GitHub call fails or token missing
- [ ] Diagnostics dump never contains the OAuth token, AI key, or any `*secret*` field
- [ ] Closing the modal resets the form

## Database / table view (d6v8)

- [ ] `` ```bases `` fence renders inline as a table (live preview)
- [ ] Same fence renders inline in the rendered preview (Ctrl+E)
- [ ] Default columns when omitted: `title`, `tags`, `modified`
- [ ] `from <folder>` filters to that folder + descendants
- [ ] `where tag <name>` filters by inline `#tag`
- [ ] `where property <key>=<value>` filters by frontmatter equality
- [ ] `columns: a, b, c` selects which columns appear
- [ ] `sort <column> [asc|desc]` orders rows
- [ ] `limit <N>` caps the row count
- [ ] Clicking a row's title opens the underlying note
- [ ] Empty result set shows "No matching notes"
- [ ] Cursor inside the fence shows the raw source for editing

### Example query

```bases
from Projects
where tag important
columns: title, tags, modified
sort modified desc
limit 10
```

## Frontmatter UI (a0p4)

- [ ] Note WITH `---\n...\n---` block shows a "Properties (N)" header above the editor
- [ ] Click the header to expand the table
- [ ] Each row is editable: key + value with appropriate input type (text / number / checkbox / comma-separated array)
- [ ] Edits save back into the note's frontmatter via writeFrontmatter
- [ ] Note WITHOUT frontmatter shows a discreet "+ Add properties" link
- [ ] Click "Add properties" seeds an empty `tags: []` block + expands the panel
- [ ] Unparseable lines (no `key:`) render verbatim with an "(unparsed — edit in source)" hint
- [ ] CRLF line endings parse correctly

## Ribbon (b3e7)

- [ ] **Drag a ribbon icon up or down** to reorder
- [ ] Drop indicator (purple line) shows above/below the target
- [ ] Order survives reload (persisted in `settingsStore.ribbonOrder`)
- [ ] Adding a new ribbon item in a release auto-appears at the end of the user's customised list (doesn't reset their order)
- [ ] GitHub icon still hides when not connected (visibility check)

## Note embeds (z9o3)

- [ ] `![[Title]]` in rendered preview shows the referenced note's content as a blockquote
- [ ] Embedded blockquote header shows `📎 [[Title]]`
- [ ] Resolving by note alias works (`![[Alias]]` finds the aliased note)
- [ ] Missing target renders `*[no note found for \`Title\`]*`
- [ ] Cycle (A embeds B, B embeds A) renders `*[circular embed: \`A\`]*`
- [ ] Depth cap at 4 levels of nesting

## Beta features (b3t1)

- [ ] Settings → Beta → master toggle gates the flag list
- [ ] Toggling an individual flag persists across reload
- [ ] `useFlag(id)` returns false when master is off (verified via Beta panel hidden flag rows)
- [ ] Flag definitions live in `src/utils/featureFlags.ts` (FLAGS array)

## Workspace

- [ ] Single-click on a note opens as PREVIEW tab (italic) — typing promotes it (cp1 era)
- [ ] Double-click pins the tab
- [ ] Split view: drag a tab to the right edge to open a second pane
- [ ] Move tabs between panes via drag-drop
- [ ] Tab close (x or middle-click)
- [ ] Workspace persists across reloads (last-active note restored)

## E2E test harness

- [ ] Playwright auto-boots the dev server (s2b9)
- [ ] `npm run e2e` passes the existing spec set
- [ ] Failed runs save traces + videos + screenshots

---

## Notes for testers

- Use Firefox AND Chrome — sync drift, IDB usage, and emoji input differ between engines.
- After any defaults change in `src/stores/settingsStore.ts`, existing users keep their persisted value. To test the new default, do `?reset=1` first or clear `noteser-settings` from storage.
- When testing recurring tasks, try a 🔁 typed via the OS emoji picker — some pickers attach U+FE0F (variant selector). Both forms must work.

When something fails, file the bug with the orchestrator ID + browser + steps.
