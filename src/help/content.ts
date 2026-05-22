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
  body: `
# Getting started

Welcome to noteser. This is a browser-first markdown note-taking app
inspired by Obsidian — your notes live in localStorage by default and
optionally sync to a GitHub repo or a local folder on disk.

## Your first note

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
- \`Alt+N\` — new note
- \`Ctrl+Shift+N\` — new folder
- \`Ctrl+E\` — toggle preview mode
- \`Ctrl+B\` — toggle sidebar
- \`Ctrl+,\` — open settings
- \`Ctrl+W\` — close current tab

Press \`Ctrl+/\` any time to see the shortcuts modal.
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

## Connect a repo

1. Click the **GitHub** ribbon icon or open **Settings → GitHub sync**.
2. Click **Connect to GitHub**. The device-code modal opens — copy the code, click the GitHub link, paste, and authorise.
3. Pick a repo from the list. The first push will commit every existing note.

## Commit & sync

- Open the **Source Control** sidebar tab (you can pin it).
- Pending changes appear in the CHANGES tree.
- Type a commit message (or leave blank to use the default \`Sync from Noteser ({{date}})\` template).
- Click **Commit & Sync**. \`Ctrl+Enter\` in the message box does the same thing.

The default commit message is configurable in **Settings → GitHub sync → Default commit message**. The \`{{date}}\` token substitutes to today's YYYY-MM-DD at commit time.

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

Open the shortcuts cheatsheet with \`Ctrl+/\`. Some highlights:

| Action | Shortcut |
|---|---|
| Search | \`Ctrl+K\` |
| Command palette | (via the ribbon icon) |
| New note | \`Alt+N\` |
| New folder | \`Ctrl+Shift+N\` |
| Toggle preview | \`Ctrl+E\` |
| Toggle sidebar | \`Ctrl+B\` |
| Close tab | \`Ctrl+W\` |
| Open settings | \`Ctrl+,\` |
| Toggle task at cursor | \`Alt+L\` |
| Remove task prefix | \`Alt+Shift+L\` |

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

export const HELP_PAGES: ReadonlyArray<HelpPage> = [
  GETTING_STARTED,
  GITHUB_SYNC,
  LOCAL_FOLDER,
  SHORTCUTS_PINS,
  FAQ,
]

export function findHelpPage(slug: string): HelpPage | null {
  return HELP_PAGES.find(p => p.slug === slug) ?? null
}
