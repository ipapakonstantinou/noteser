// Help content for /help. Bundled as TypeScript constants rather than
// markdown files read at build time so we keep the bundle deterministic
// (no fs reads, no async loaders) and so new contributors edit content
// in one place. Edit the strings below; the /help route picks them up
// at next build.

export interface HelpPage {
  // URL slug — appears in the address bar as /help/<slug>.
  slug: string
  title: string
  // One-line summary for the sidebar TOC.
  summary: string
  // Markdown content. Multiline template strings — keep them ≤ ~200
  // lines each so the sidebar TOC stays scannable.
  body: string
}

const GETTING_STARTED: HelpPage = {
  slug: 'getting-started',
  title: 'Getting started',
  summary: 'A 60-second tour of noteser — the editor, sidebar, and your first note.',
  // Intro prose is copied (not iframed) from the in-app WelcomePane so a
  // first-time visitor reading /help sees the same product framing as a
  // first-time user inside the app. Keeping the prose as plain markdown
  // avoids mounting the live component, which assumes a connected store.
  body: `
# Getting started

Edit Markdown notes in your browser, on top of a GitHub repo you own.
When the same note changed in two places, you see every conflict line
by line and pick yours, theirs, or both. The merge UX from VS Code,
in the browser, on your repo.

![Typing a note in noteser: live-preview Markdown with wikilinks, tags, and tasks](/demo/noteser-demo.gif)

*Live-preview editing with wikilinks, tags, and tasks.*

## Your first note

![Editor with a sample note open, sidebar on the left listing folders and notes](/screenshots/help/getting-started-first-note.png)

- Press \`Alt+N\` to create a new note, or click the **New note** button in the file tree toolbar.
- Type a title at the top, then markdown content below.
- Notes save automatically — there's no Save button.

## The layout

- **Left ribbon** — quick actions (New note, Today's daily note, Command palette, Templates) + Settings.
- **Left sidebar** — a tab strip with Files / Calendar / Outline / Source Control / Search / Bookmarks / Related notes. Drag a tab up to pin it permanently.
- **Editor** — the main writing area. Each tab is one note.
- **Right sidebar** — Properties panel for the active note (title, tags, pinned, file path, timestamps). Click the toggle on the far-right edge to expand.

## Markdown basics

Noteser renders standard markdown plus a few extensions:

- **Wikilinks** — \`[[Note title]]\` links to another note in your vault.
- **Tags** — \`#projects #urgent\` anywhere in the body. The right sidebar surfaces them.
- **Task lines** — \`- [ ] something\` becomes a clickable checkbox.
- **Fenced tasks** — \`\\\`\\\`\\\`tasks ... \\\`\\\`\\\`\` queries tasks across notes.

## Keyboard shortcuts

A few essentials — full list under **Settings → Shortcuts**:

- \`Ctrl+K\` — open search
- \`Ctrl+F\` — find in current note (\`Ctrl+H\` for find-and-replace)
- \`Ctrl+Alt+T\` — insert a markdown table at the cursor
- \`Alt+N\` — new note
- \`Ctrl+Shift+N\` — new folder
- \`Ctrl+E\` — toggle preview mode
- \`Ctrl+B\` — toggle sidebar
- \`Ctrl+,\` — open settings
- \`Alt+W\` — close current tab

Press \`Ctrl+/\` any time to see the shortcuts modal. For deeper dives on
each editor power feature see [Editor power features](/help/editor).
`,
}

const GITHUB_SYNC: HelpPage = {
  slug: 'github-sync',
  title: 'GitHub sync',
  summary: 'Connect a GitHub repo, push your vault, pull edits from other devices.',
  body: `
# GitHub sync

Noteser can sync your vault with a GitHub repo. One commit per sync,
clean three-way merge, no plugins or extensions required — it talks
to the GitHub Git Data API directly from the browser.

![Source control panel: pending changes, Commit and Sync, recent commit history](/demo/noteser-git-demo.gif)

*Commit and sync, view pending changes, scroll through history.*

## Connect a repo

![Settings panel open on the GitHub sync section, showing auto-sync, default commit message, and vault gitignore fields](/screenshots/help/github-sync-settings.png)

1. Click the **GitHub** ribbon icon or open **Settings → GitHub sync**.
2. Click **Connect to GitHub**. The device-code modal opens — copy the code, click the GitHub link, paste, and authorise.
3. Pick a repo from the list. The first push will commit every existing note.

## Commit & sync

- Open the **Source Control** sidebar tab (you can pin it).
- Pending changes appear in the CHANGES tree.
- Type a commit message (or leave blank to use the default \`Sync from Noteser ({{date}})\` template).
- Click **Commit & Sync**. \`Ctrl+Enter\` in the message box does the same thing.

The default commit message is configurable in **Settings → GitHub sync → Default commit message**. The \`{{date}}\` token substitutes to today's YYYY-MM-DD (same format as daily-note titles) — the commit box shows the resolved date, never the literal placeholder.

## Conflicts

If you and another device both edited the same note since the last sync, the merge tab opens automatically. Each side is shown line-by-line; pick **Mine** / **Theirs** / **Merge** per chunk, then **Apply**.

If three or more conflicts open at once, the **Merge batch** view summarises them with bulk "Keep all mine" / "Take all theirs" buttons.

## Vault encryption

Optional — encrypts note bodies before push. Enabled in **Settings → GitHub sync → Vault encryption**. Pick a 12+ character passphrase; it's never persisted. Every page refresh re-locks the vault; you'll be prompted on next sync.

**There is no recovery if you forget the passphrase.** Use a password manager.

## Reset to remote

**Settings → GitHub sync → Reset to remote** discards local edits to pushed notes and pulls fresh from GitHub. Unpushed local notes are preserved by default.
`,
}

const LOCAL_FOLDER: HelpPage = {
  slug: 'local-folder',
  title: 'Local folder sync',
  summary: 'Mirror your vault to a folder on disk. Chromium-only.',
  body: `
# Local folder sync

Mirror your vault to a folder on your computer's disk — Obsidian-style.
Edit notes in any text editor, push to a local backup folder, or
manage everything as a git repo from inside noteser.

Chromium-only — Chrome, Edge, Brave, Arc, or Opera. Firefox + Safari
don't ship the File System Access API yet.

## Connect a folder

1. Open **Settings → Local folder**.
2. Click **Connect a folder…**.
3. Pick a directory in the browser picker. Grant read/write permission.

After connecting, the folder name appears in Settings. The folder handle is remembered across sessions, but the browser re-prompts for permission once per session (security model).

## Sync directions

- **Push vault to folder** — writes every active note as a \`.md\` file at its repo path (or sanitised \`<title>.md\` at the root for unpushed notes).
- **Sync from folder…** — opens a preview modal showing new / updated / unchanged counts, then on confirm overwrites local notes with what's in the folder.

There's no auto-mirror on save in v1 — you click the buttons explicitly. (The browser has no real-time filesystem watch yet.)

## In-folder git

If the folder is or should be a git repo, the **In-folder git** subsection lets you drive the whole git lifecycle from inside noteser:

1. **Initialise git repo** — runs \`git init\` on the folder.
2. **Set remote** — paste a GitHub URL like \`https://github.com/owner/repo.git\`.
3. **Commit** — stages all \`.md\` + \`.noteser/*.json\` files, commits with your GitHub identity.
4. **Push to origin** — pushes via a CORS-friendly proxy on noteser's own infra.

You'll need a connected GitHub token (Settings → GitHub sync) for push to work.

## Trade-offs vs GitHub Sync

| Feature | GitHub sync | Local folder + in-folder git |
|---|---|---|
| Three-way merge | yes | external (your \`git pull\` does it) |
| Conflict UI | merge editor | none — git CLI / IDE |
| Browser support | all modern | Chromium only |
| Works offline | no (needs GitHub API) | yes (commit), no (push) |

Use GitHub sync if you mostly write inside noteser. Use local-folder + in-folder git if you want to edit in another editor or want full git history offline.
`,
}

const SHORTCUTS_PINS: HelpPage = {
  slug: 'sidebar',
  title: 'Sidebar, panels, and shortcuts',
  summary: 'How to pin panels, hide tabs, and find the keyboard shortcuts.',
  body: `
# Sidebar, panels, and shortcuts

## Pinning panels

![Sidebar showing a pinned Calendar panel at the top and the Files panel below it, with the mini tab strip in between](/screenshots/help/sidebar-pane-model.png)

The left sidebar's bottom strip has tab icons (Calendar, Files, Outline, etc.). To keep a panel visible at the top of the sidebar:

- **Right-click** the tab icon → **Pin to top**.
- Or **drag** the tab icon UP to the pinned-area drop zone.

To unpin: right-click the mini-strip icon → **Unpin**.

You can have multiple pinned groups stacked vertically. Drag a tab from one group's strip onto another group's strip to combine them.

## Hiding tabs

Don't use a tab? Right-click it → **Hide tab**. It disappears from both strips.

To restore: **Settings → Sidebar** lists every hidden tab with a **Show** button.

## Collapsing pinned panels

Each pinned group has a chevron at the left of its mini-strip. Click to collapse the panel body (the strip stays visible). Click again to expand.

Collapse state persists across reloads, per group.

## Right sidebar

The right edge of the screen has a thin strip with a panel-toggle icon. Click → 280px panel opens showing **Properties** for the active note (title, tags, pin toggle, gitPath, timestamps).

The body is hidden by default; the strip stays as a quick-access affordance.

## Keyboard shortcuts

![Quick search modal open with a query typed and three note results listed below it](/screenshots/help/search-quick-switcher.png)

Open the shortcuts cheatsheet with \`Ctrl+/\`. Some highlights:

| Action | Shortcut |
|---|---|
| Search | \`Ctrl+K\` |
| Command palette | (via the ribbon icon) |
| New note | \`Alt+N\` |
| New folder | \`Ctrl+Shift+N\` |
| Toggle preview | \`Ctrl+E\` |
| Toggle sidebar | \`Ctrl+B\` |
| Close tab | \`Alt+W\` |
| Open settings | \`Ctrl+,\` |
| Toggle task at cursor | \`Alt+L\` |
| Remove task prefix | \`Alt+Shift+L\` |
| Find in note | \`Ctrl+F\` |
| Find & replace | \`Ctrl+H\` |
| Insert markdown table | \`Ctrl+Alt+T\` |
| Open today's daily note | (via ribbon button or empty-state CTA) |

Shortcut conflicts? **Settings → Shortcuts** lets you remap any of them.
`,
}

const FAQ: HelpPage = {
  slug: 'faq',
  title: 'FAQ & troubleshooting',
  summary: 'Common questions and how to fix things when they go wrong.',
  body: `
# FAQ & troubleshooting

## My notes disappeared after a reload

Most likely: a browser extension or the browser itself cleared localStorage. Open DevTools → Application → Local Storage and check for the \`noteser-notes\` key. If it's gone but your vault was synced to GitHub, click **Settings → GitHub sync → Reset to remote** to repopulate.

## "Vault is locked" — what now?

You enabled encryption (Settings → GitHub sync). The passphrase isn't persisted, so every page refresh re-locks the vault. Click the **Unlock** prompt or open **Settings → GitHub sync → Vault encryption → Unlock…** and type your passphrase.

## I forgot my encryption passphrase

There is no recovery. The passphrase derives the key — without it, the encrypted blobs on GitHub are unreadable. Options:

1. Disable encryption (Settings → GitHub sync → Disable encryption), then re-enable with a new passphrase. Existing encrypted notes on remote become permanently unreadable.
2. Restore from a local backup (if you've been doing **Push vault to folder**).

## How do I migrate from Obsidian?

Drop your \`.md\` files into a folder, connect that folder via **Settings → Local folder**, click **Sync from folder…**, confirm the import. Wikilinks (\`[[Note]]\`) carry across. Frontmatter \`tags:\` gets flattened to inline \`#tag\` lines.

## Why can't I connect a local folder in Firefox / Safari?

Those browsers don't yet support the File System Access API. Chrome, Edge, Brave, Arc, and Opera all work. Or wait for the native desktop wrap (Tauri) — coming later.

## My GitHub push fails with "Vault is locked"

Encryption is enabled but the vault is locked. Unlock first (Settings → GitHub sync → Vault encryption → Unlock…), then retry.

## My GitHub push fails with "Token is missing the gist scope"

You're trying to publish a gist for the first time. The token was issued before noteser added gist support. Disconnect and reconnect GitHub — the new authorisation includes the gist scope.

## Where are my notes stored?

- **Always**: in your browser's localStorage under \`noteser-notes\` + \`noteser-folders\`.
- **If GitHub sync is connected**: also as \`.md\` files in your GitHub repo, on every successful Commit & Sync.
- **If Local folder is connected**: also as \`.md\` files in the picked folder, on every Push to folder.

## How do I report a bug?

**Settings → About → Report a bug**. Fills a pre-formatted GitHub issue with your noteser version + browser + recent activity.
`,
}

const EDITOR_POWER: HelpPage = {
  slug: 'editor',
  title: 'Editor power features',
  summary: 'Per-line revert, find/replace, tag and wikilink autocomplete, markdown table insert.',
  body: `
# Editor power features

These tools live inside the note editor and turn it from "a textarea" into
something closer to VS Code or Obsidian.

![Live preview rendering as you type, with a tasks code block aggregating items across the vault](/demo/noteser-tasks-demo.gif)

*Live-preview formatting and a tasks query rendering inline.*

## Per-line revert (after sync)

![Editor showing the note body in live-preview mode with formatted headings, bullet points, and inline tags](/screenshots/help/editor-live-preview.png)

When you've synced a note to GitHub, the editor paints a thin colored
bar in the left gutter next to lines that differ from the version you
last pushed:

- **green** = added line
- **yellow** = modified line

**Click any bar** to revert that hunk to the last-pushed version. The
revert is a single edit, so \`Ctrl+Z\` restores it instantly. Multi-line
hunks revert as one unit — click anywhere in the hunk.

Useful when you've been tinkering and want to drop just one paragraph
without losing the rest of your edits.

## Find / replace (Ctrl+F, Ctrl+H)

\`Ctrl+F\` opens an inline find panel at the top of the editor. Type to
highlight every match in yellow. \`Enter\` jumps to the next match,
\`Shift+Enter\` to the previous. \`Esc\` closes the panel.

The panel always has a **Replace** field too — \`Ctrl+H\` opens the same
panel (Obsidian convention) and focuses the find input. Options for
**Match case**, **Regex**, and **Match whole word** are on the right.

## Tag autocomplete on \`#\`

Type \`#\` after whitespace or punctuation. A dropdown appears with every
existing tag in your vault, ranked by usage count. Filter by typing more
characters. \`↑/↓\` to navigate, \`Enter\` or \`Tab\` to insert,
\`Esc\` to dismiss.

Mid-word \`#\` (e.g. \`color#fff\`) is **not** a tag start — the dropdown
won't open and the parser won't index it.

## Wikilink autocomplete on \`[[\`

Same idea for notes: type \`[[\` and a dropdown lists your notes with
fuzzy match on title and aliases. \`Enter\` inserts \`[[Note Title]]\`.

If the typed query matches an **alias**, the row shows
\`(alias: <name>)\` so you know why it surfaced.

## Markdown table insert (Ctrl+Alt+T)

Drops a 2-row × 2-col GFM table at the cursor:

\`\`\`
| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |
| Cell 3 | Cell 4 |
\`\`\`

\`Header 1\` is pre-selected so you can immediately type to overwrite the
first column heading. On a non-empty line, the table is inserted on its
own block (preceded by a blank line).

## AI actions on the active note

Right-click any note in the sidebar → **AI actions**, or open the
command palette (\`Ctrl+Shift+P\`) and type "AI:". Five actions ship:

- **Summarize note** — 3–5 sentence summary
- **Extract tasks** — pulls actionable items into a checklist
- **Suggest tags** — proposes 3–7 \`#tags\` from the body
- **Rewrite for clarity** — polishes the prose without changing meaning
- **Translate…** — into a target language you specify

Requires a BYO Anthropic or OpenAI API key in **Settings → AI**.
`,
}

const MOBILE_HELP: HelpPage = {
  slug: 'mobile',
  title: 'Mobile / touch shortcuts',
  summary: 'Edge-swipe drawer, formatting toolbar, and the layout changes that kick in below 768px.',
  body: `
# Mobile / touch shortcuts

Below 768px the layout switches to a single-pane mobile mode with an
off-canvas drawer for the sidebar.

![Noteser on iPhone: open the drawer, navigate the file tree, open a note](/demo/noteser-mobile-demo.gif)

*The mobile drawer and single-pane editor.*

## Edge-swipe drawer

- **Right-swipe** from within ~24px of the left edge → opens the sidebar drawer.
- **Left-swipe** anywhere with the drawer open → closes it.

Short swipes (<50px) or mostly-vertical motion (regular scrolling) are
ignored — the gesture has to be deliberately horizontal.

## Mobile formatting toolbar

A 5-button strip sits below the editor on mobile (phones lack the
keyboard shortcuts):

- **B** — wrap selection in \`**...**\` (bold). Tap again on the same
  selection to strip the markers.
- **I** — same, with \`_..._\` (italic).
- **H** — cycle the current line's heading: \`none → # → ## → ### → none\`.
- **• (Bullet)** — toggle \`- \` prefix on every selected line.
- **☑ (Task)** — toggle \`- [ ] \` prefix on every selected line.

The toolbar hides in preview mode.

## Empty-state CTAs

When no note is open, the editor pane shows two big buttons:

- **Open today's daily note** — same as the ribbon's daily-note icon.
- **New note** — adds a fresh "Untitled" and opens it.

Useful first-launch landing surface.

## What's NOT on mobile

- The split-pane drag affordance (right-edge drop zone for tabs). One
  pane only on phones.
- The keyboard-shortcut bar in the editor header. Use the mobile
  formatting toolbar instead.

## Tips

- Tap the hamburger in the top-left to toggle the drawer manually.
- Most modals (Settings, Search, Templates) are full-screen on phones
  so they don't get clipped.
`,
}

const PLUGINS: HelpPage = {
  slug: 'plugins',
  title: 'Plugins',
  summary: 'Install a third-party plugin from a URL, or write your own. The plugin SDK + capability model.',
  body: `# Plugins

Noteser plugins extend the app at three surfaces:

1. **Commands.** Show up in the command palette (Ctrl+P).
2. **Sidebar panels.** Stack inside the new "Plugins" tab in the sidebar.
3. **Code-block renderers.** Claim a fenced-code language (e.g. \`\`\`chart) and turn its body into rendered output.

Plugin code runs in an isolated Web Worker. It has no DOM access, cannot read your GitHub token, and cannot see the bodies of notes you are not currently viewing. Titles + folder paths of every note are visible; that is the only cross-vault read.

## Installing a plugin

1. Open **Settings → Plugins**
2. Paste the URL of the plugin's \`manifest.json\` (must be HTTPS, except localhost in dev)
3. Click **Add**

Noteser fetches the manifest, validates the v1 schema, fetches the bundle, SHA-256 hashes it, and boots the plugin in a worker. The hash is stored alongside the bundle so a tampered or swapped bundle gets caught on the next page load.

## Writing a plugin

Install the SDK:

\`\`\`bash
npm install @noteser/plugin-sdk
\`\`\`

Minimum plugin:

\`\`\`ts
import { definePlugin } from '@noteser/plugin-sdk'

export default definePlugin({
  id: 'my-plugin',
  name: 'My plugin',
  version: '1.0.0',
  surfaces: {
    commands: [{ id: 'hello', title: 'Say hello' }],
  },
  onCommand(id, ctx) {
    if (id === 'hello') ctx.notify('Hello from my plugin')
  },
})
\`\`\`

Bundle to a single ES module (esbuild, rollup, vite — any will do), host \`main.js\` + \`manifest.json\` at any HTTPS URL, then paste the manifest URL into Settings → Plugins.

## The PluginCtx capability surface

Your handlers receive a \`ctx\` object. v1 capabilities:

- \`ctx.activeNote\` — the currently-open note: \`{ id, title, content }\` or null
- \`ctx.notes\` — every non-deleted note: \`{ id, title, folderPath }\` (titles + paths only, NOT bodies)
- \`ctx.setPanelContent(panelId, node)\` — replace the content of one of your declared sidebar panels
- \`ctx.renderCodeBlock(blockId, node)\` — return the rendered output of a code block
- \`ctx.insertText(text)\` — insert text at the cursor in the active editor
- \`ctx.notify(message)\` — show a toast
- \`ctx.getSetting(key)\` / \`ctx.setSetting(key, value)\` — per-plugin namespaced storage

The \`node\` parameter to \`setPanelContent\` and \`renderCodeBlock\` is a virtual-DOM shape. v1 recognises \`{ tag: 'text', value: string }\`; the full curated component set lands in v2.

## What is intentionally NOT in v1

- Custom React components from plugins (security audit per component)
- Editor extensions (CodeMirror keybindings, lint)
- Sync hooks (custom export formats, commit hooks)
- Network access (\`fetch\` from inside the worker)
- Background tasks while no panel is open
- Plugin-to-plugin communication

See the [v1 design plan](https://github.com/ipapakonstantinou/noteser/blob/main/docs/plugins-plan.md) for the full roadmap and the reasoning.

## Troubleshooting

**"Plugin failed to load: HTTPS only"** — the manifest or main URL is plain HTTP. Use HTTPS, or develop against \`http://localhost\` (dev mode).

**"Plugin failed an integrity check"** — the stored SHA-256 hash does not match the stored bundle. Uninstall + reinstall.

**Plugin is installed but does not show up in the command palette or sidebar** — open Settings → Plugins and confirm the Enabled toggle is on, then reload the page.
`,
}

export const HELP_PAGES: ReadonlyArray<HelpPage> = [
  GETTING_STARTED,
  EDITOR_POWER,
  MOBILE_HELP,
  GITHUB_SYNC,
  LOCAL_FOLDER,
  SHORTCUTS_PINS,
  PLUGINS,
  FAQ,
]

export function findHelpPage(slug: string): HelpPage | null {
  return HELP_PAGES.find(p => p.slug === slug) ?? null
}
