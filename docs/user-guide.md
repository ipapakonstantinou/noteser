# User guide

Everything you can do with noteser, organized by feature. Skim the table of
contents; jump to what you need.

- [Notes and folders](#notes-and-folders)
- [Daily notes](#daily-notes)
- [Wikilinks](#wikilinks)
- [Tags](#tags)
- [Tasks](#tasks)
- [Tasks queries (the ```tasks fence)](#tasks-queries)
- [Workspace: tabs and split editor](#workspace-tabs-and-split-editor)
- [GitHub sync](#github-sync)
- [Search](#search)
- [Export and import](#export-and-import)
- [Keyboard shortcuts](#keyboard-shortcuts)

## Notes and folders

Click **New note** in the sidebar ribbon or press `Alt+N` from anywhere.
The note opens in a tab and gets focus.

Folders work the same way — **New folder** in the ribbon or `Ctrl+Shift+N`.
You can nest folders by right-clicking a folder → **New subfolder**.

**Drag-and-drop**: grab a note in the sidebar to move it to a different
folder. Grab a folder to move it (and everything inside) under another one.

**Right-click menu** on any note or folder: rename, move, delete, new
subfolder. Renaming inline edits the title; pressing `Enter` saves.

**Soft delete**: deleting a note marks it as deleted but keeps it in
storage. The sidebar's **Trash** view lists soft-deleted notes; you can
restore or permanently delete from there.

## Daily notes

Open the calendar view in the sidebar. Clicking a date creates a note
titled with the date if one doesn't exist, or opens the existing note.
Use this as a journal, daily standup, or scratch pad anchored in time.

The current day is highlighted. The calendar shows the current month;
click left/right to navigate.

## Wikilinks

Type `[[` anywhere in a note to start a wikilink. An autocomplete dropdown
appears with matching note titles; arrow keys to highlight, `Enter` to
insert. Close with `Esc` or by typing `]]` manually.

**Rendered**: wikilinks become clickable links in both the live preview
(while editing) and the rendered preview (`Ctrl+E`). Click to open. If
the target doesn't exist the link is red.

**Aliasing**: `[[note title|display text]]` shows "display text" while
linking to "note title". Useful when the note's actual title is too long
or differs from your prose.

**Ctrl/Cmd+click** a wikilink in the editor to jump to it without
exiting the editor.

## Tags

Type `#word` anywhere in a note body — that's a tag. No registration step,
no separate tag list. Tags are derived from your note text.

Examples that work: `#project`, `#deep-work`, `#proj/client/2026`,
`#a1`. Not tags: `foo#bar` (only counts at word boundaries),
`#` inside fenced code blocks.

**Sidebar Tags view** lists every tag found across your active notes,
with a count. Clicking a tag filters the note list to notes that mention
it. Click again (or click another tag) to switch.

**Styling**: tags get a tinted background everywhere they appear —
live preview, rendered preview, and the sidebar.

## Tasks

Two task syntaxes work, both based on Markdown task lists:

```markdown
- [ ] open task
- [x] completed task
```

In the **editor** (live preview):

- `Alt+L` on a plain line → prepends `- [ ] ` (converts to a task)
- `Alt+L` on a task line → strips `- [ ] ` (converts back to plain text)
- `Alt+Shift+L` on a task line → checks/unchecks. Checking appends
  `✅ YYYY-MM-DD` for today; unchecking strips it. (Obsidian Tasks-plugin
  behavior.)
- **Click the `[ ]` marker directly** to check/uncheck (also stamps the
  ✅ date).

In the **rendered preview** (`Ctrl+E`):

- Click any rendered checkbox to check/uncheck (stamps the ✅ date).
- `Alt+L` on the task at cursor → check/uncheck.
- `Alt+Shift+L` on the task at cursor → strip the `- [ ]` prefix.

The ✅ date format is `YYYY-MM-DD` in your local timezone — the same
format the Obsidian Tasks plugin produces, so notes round-trip cleanly.

## Tasks queries

Write a fenced code block with `tasks` as the language to render a live,
filtered view of tasks across all your notes:

````markdown
```tasks
not done
path includes Projects
group by folder
```
````

Renders inline as a styled task list. Toggling a checkbox in the rendered
list updates the underlying note. Works in both the live preview and the
rendered preview.

**Supported filters**:

- `not done` / `done` — by completion state
- `path includes <text>` / `path does not include <text>` — by folder path
- `tag includes <text>` / `tag does not include <text>` — by tag
- `created on <YYYY-MM-DD>` / `created before <date>` / `created after <date>`
- `done on <date>` / `done before/after <date>` (matches the ✅ date)
- `description includes <text>` — substring match on the task body

**Grouping**: `group by folder`, `group by tag`, `group by filename`.

**Explain**: add `explain` on its own line to render a human-readable
summary of the query at the top — useful while you're tuning it.

**Limit**: `limit 10` to cap result count.

## Workspace: tabs and split editor

Each note open in the editor area is a tab. Tabs work like in VS Code:

- **Single-click** a note in the sidebar → opens as a *preview* tab
  (italic title). Typing into the note promotes it to a pinned tab.
- **Double-click** in the sidebar → opens pinned directly.
- **Middle-click** a tab → closes it.
- **Drag a tab** → reorder within the pane, or drag to the right edge of
  the editor area to create a second pane (horizontal split). Max two
  panes.
- **Drag between panes** to move a tab.

The split is horizontal only — two side-by-side panes, each with its own
independent tabs. Useful for cross-referencing two notes while writing.

## GitHub sync

Use any GitHub repo (public or private) as your notes vault.

**One-time setup**:

1. Click the cloud icon in the sidebar → **Connect GitHub**.
2. Approve the device-flow code at the GitHub URL it shows you.
3. Pick a repo and branch.

That's it. Your notes now sync to that repo as `.md` files under whatever
folder structure you have in noteser.

**Pushing changes**: click **Sync** (cloud icon when there are pending
changes). The push:

1. **Pulls first** — fetches the remote, classifies each `.md` as
   unchanged / new / updated / deleted / conflict.
2. **Applies non-conflicts** locally (new remote notes appear, remote
   deletions soft-delete locally, etc).
3. **Opens conflicts as merge tabs** — one tab per conflicting file, with
   a VS Code-style inline merge UI (line-level diff, accept-yours /
   accept-theirs / keep-both buttons).
4. **Pushes once all conflicts are resolved** — single commit, fast-forward
   the branch.

**Conflict resolution**: in a merge tab, each conflicting hunk gets three
buttons: accept local, accept remote, keep both. Once every hunk has been
chosen, the tab's **Apply** button writes the merged content back to the
note. Closing the last merge tab auto-retries the sync.

**Three-way merge**: noteser remembers the last SHA it pushed for each
note (`gitLastPushedSha`), so a remote-only edit OR a local-only edit
each merges cleanly. Only when both sides edit the same lines does it
flag a conflict.

For the full deep-dive on the sync pipeline, see [sync.md](./sync.md).

## Search

`Ctrl+K` opens the search modal. Searches across all your notes —
titles weighted heaviest, then body content, then tags. Fuzzy matching
via Fuse.js, so typos are forgiven.

Results show a snippet of the matching context. Click to open the note.

## Export and import

Sidebar menu → **Export**. Choose:

- **Markdown** — one `.md` file per note (folder structure preserved),
  bundled in a zip.
- **JSON** — single file with the full state (notes, folders, metadata).
  Useful for backup or transferring to another browser/device.
- **HTML** — rendered notes as standalone HTML pages.

Import accepts the JSON format. The Markdown/zip format is one-way for
now (no batch markdown import).

## Keyboard shortcuts

The full list is in the README. Highlights:

| Shortcut | What it does |
| --- | --- |
| `Ctrl+K` | Open search |
| `Ctrl+E` | Toggle preview |
| `Ctrl+B` | Toggle sidebar |
| `Alt+N` | New note (always at root) |
| `Ctrl+Shift+N` | New folder (always at root) |
| `Alt+L` (editor) | Convert line ↔ task |
| `Alt+L` (preview) | Check/uncheck task at cursor |
| `Alt+Shift+L` (editor) | Check/uncheck task (with ✅ date) |
| `Alt+Shift+L` (preview) | Strip `- [ ]` prefix |
| `Ctrl+/` | Show the full shortcut list |

`Ctrl+/` opens a modal listing every shortcut — useful when you forget.
