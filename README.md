<h1 align="center">Noteser</h1>

<p align="center"><strong>A notes app that runs in your browser and keeps your notes in your own GitHub repo.</strong></p>

<p align="center"><a href="https://noteser.app"><strong>Open noteser.app →</strong></a></p>

<p align="center">
  <img src="./public/screenshot.png" alt="Noteser" width="900">
</p>

Write in Markdown, organize with folders and `[[links]]`, and keep everything as plain `.md` files in a GitHub repo you control. No account to start. Nothing to install.

## What you get

- **Start in one click.** Open the app and write. Your notes save in your browser, so there is no sign-up and no setup.
- **Your notes stay yours.** Connect a GitHub repo and your notes sync as clean Markdown files you can read, edit, or move anywhere. Leave GitHub out and everything still works, just locally.
- **Obsidian-style writing.** Wikilinks (`[[note]]`), inline `#tags`, a daily-notes calendar, live-preview Markdown, and task lists with checkboxes.
- **Built for tasks.** Toggle a line into a checkbox, stamp a done-date when you finish, and pull up everything you completed today.
- **Tabs and split view.** Keep several notes open, drag tabs to reorder, double-click to pin, and split the editor to read two notes side by side.
- **Works offline.** Installable as an app, keeps working without a connection, and updates itself when a new version ships.
- **Two-way sync, safely.** Click *Sync* to push your changes and pull anyone else's. When the same note changed on both sides, a per-line resolver lets you keep exactly what you want.

## Connect your GitHub vault

1. In the sidebar footer, click **Connect to GitHub**.
2. Enter the 6-character code it shows you on github.com.
3. Pick an existing repo or create a new one as your vault.
4. Click **Sync** whenever you want to save up to GitHub and pull changes back down.

Your notes land as ordinary `.md` files in folders that match your sidebar, so the same vault opens fine in Obsidian, a text editor, or straight on github.com.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + K` | Open search |
| `Ctrl + /` | Show all shortcuts |
| `Ctrl + E` | Toggle preview mode |
| `Ctrl + B` | Toggle sidebar |
| `Ctrl + F` | Find in current note |
| `Ctrl + H` | Find and replace in current note |
| `Ctrl + Delete` | Delete current note |
| `Ctrl + Shift + 7` | Insert numbered list |
| `Ctrl + Shift + T` | Insert todo item |
| `Alt + L` | Convert line to/from task (editor); check/uncheck task (preview) |
| `Alt + Shift + L` | Check/uncheck task and stamp a done-date |
| `Ctrl + Alt + T` | Insert a Markdown table |
| `Escape` | Close modal / search |

Right-click any note or folder for rename, move, delete, or new subfolder.

## Roadmap

See [`docs/roadmap.md`](./docs/roadmap.md) for what is planned (Now / Next / Later).


## Contributing

Want to help? We'd love your contribution. Check out the [good first issues](https://github.com/ipapakonstantinou/noteser/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) to get started.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full workflow.

---

## For developers

Noteser is a standard Next.js project, and contributions are welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow and [`CLAUDE.md`](./CLAUDE.md) for deeper architecture notes.

<p>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" alt="Next.js">
</p>

### Run it locally

```bash
npm install
npm run dev          # http://localhost:3001
```

| Command | What it does |
| --- | --- |
| `npm run build` | Production build |
| `npm run lint` | ESLint via Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest |

### Environment variables

Create a `.env.local` in the project root:

```ini
# Required for GitHub sync to work. Get this from
# https://github.com/settings/developers
NEXT_PUBLIC_GITHUB_CLIENT_ID=Ov23li...

# Optional. If set, the editor connects to your y-websocket server for
# real-time collaboration. Leave unset to use local-only persistence (the
# default; the previous public demo server was removed for security).
NEXT_PUBLIC_YJS_WS_URL=wss://your-server.example.com
```

`.env.local` is gitignored. For your hosting platform, add the same keys to the project's environment-variable settings.

### Setting up the GitHub OAuth app

1. https://github.com/settings/developers → **New OAuth App**
   - Application name: anything (e.g. `Noteser local`)
   - Homepage URL: `http://localhost:3001` for dev, or your deployed URL for prod
   - Authorization callback URL: same as Homepage URL (device flow ignores it but the field is required)
2. After creating, edit the app and tick **Enable Device Flow**.
3. Copy the **Client ID** into `.env.local` as `NEXT_PUBLIC_GITHUB_CLIENT_ID`. No client secret needed.
4. Restart the dev server so it reads the new env var.

### Deploying

Production runs at **[noteser.app](https://noteser.app)**. The app is a standard Next.js
project, so any platform that supports Next.js server routes will work (Vercel, Netlify,
Cloudflare Pages with the adapter, your own VPS). The two `/api/github/*` routes are
required (they proxy the OAuth device-flow endpoints which do not support CORS), so a
pure-static export will not work.

For a custom domain:
1. Point a `CNAME` (or `A`) record to your hosting platform.
2. Set `NEXT_PUBLIC_GITHUB_CLIENT_ID` (and optionally `NEXT_PUBLIC_YJS_WS_URL`) in the platform's environment variables.
3. In the GitHub OAuth App settings, change Homepage / Authorization callback URL to your production domain.

#### Branch model

| Branch | Auto-deploys to | Purpose |
|---|---|---|
| `main` | noteser.app | Production. Only PR-merge from `dev` or hotfixes |
| `dev` | `noteser-git-dev-*.vercel.app` (auto) | Integration / preview |
| `feat/*` · `fix/*` | per-branch preview URLs | Feature work |
| `hotfix/*` | per-branch preview URL | Prod emergencies, PR straight to `main` |

CI (`.github/workflows/ci.yml`) runs lint + typecheck + tests + build on every push and
PR, so read the badge before merging. Full workflow is in
[`docs/release-process.md`](docs/release-process.md).

### Architecture (10 000 ft)

- **Next.js 15 / React 19**, single-page layout in `src/app/page.tsx`.
- **State**: Zustand stores in `src/stores/` (`note`, `folder`, `tag` legacy, `ui`, `github`, `workspace`). All persisted to `localStorage` under `noteser-*` keys.
- **Workspace = panes**. Two horizontal panes max; each pane has its own tabs[]. Merge-conflict resolution opens as a tab, not a modal.
- **Editor**: CodeMirror 6 (`@uiw/react-codemirror`) with a custom live-preview StateField that styles markdown inline (headings, bold, lists, blockquotes, tags).
- **GitHub sync**: device-flow OAuth (proxied through two thin Next.js API routes because GitHub's OAuth endpoints lack CORS), then direct calls to `api.github.com` from the browser. Single-commit-per-sync via the Git Data API; three-way merge using a local `gitLastPushedSha` per note.
- See [`CLAUDE.md`](./CLAUDE.md) for deeper detail.

### Security notes

- The GitHub access token lives in `localStorage`. An XSS would expose it. This is the same trust model the Obsidian Git plugin uses: acceptable for a personal vault, NOT for a hosted multi-user app.
- The two `/api/github/*` proxy routes are unauthenticated. Per-IP rate limiting is in place, but if you self-host on public infrastructure, consider tightening further.
- Real-time collaboration (`useCollaboration`) is opt-in via `NEXT_PUBLIC_YJS_WS_URL`. The previous default was the public `wss://demos.yjs.dev`, removed because anyone with a note id could read or write.
