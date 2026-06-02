# Plugins v1 — design plan

Status: DRAFT for review. Locked once Jon approves the surface list +
sandboxing model. After that, `feat/plugins-v1` opens as a long-running
branch.

## Goal

Let a third party write a small JavaScript module that adds new
behaviour to Noteser without forking the codebase, and without putting
the user's GitHub token or vault content at risk.

A v1 plugin can do exactly three things:

1. Register a command in the command palette (Ctrl+P).
2. Register a sidebar panel that mounts a rectangle of HTML produced
   by the plugin.
3. Register a code-block renderer for a fenced-code language
   (e.g. ` ```mermaid `, ` ```chart `).

Anything beyond those three surfaces is out of scope for v1.

## Non-goals (v1)

These are intentionally NOT in v1. Each may land later as a separate
plan doc.

- Modifying the editor (CodeMirror extensions, custom keybindings
  beyond what a command palette entry already gives).
- Hooking into the sync pipeline (export formats, commit hooks,
  custom merge resolvers).
- Background tasks that run while no plugin UI is open.
- Plugin-to-plugin communication.
- A paid-plugin marketplace.
- Mobile-specific plugin features (touch gestures, native bridges).

## Architecture

Capability-mediated + Web Worker isolation. Plugin code never touches
the noteser main thread DOM or the noteser stores directly.

```
┌──────────────────────────── browser tab ─────────────────────────────┐
│                                                                      │
│  ┌────────────── main thread (noteser app) ──────────────┐           │
│  │                                                       │           │
│  │  PluginHost                                           │           │
│  │   ├── load manifest                                   │           │
│  │   ├── spawn Worker for plugin code                    │           │
│  │   ├── wire postMessage bridge                         │           │
│  │   ├── translate plugin "render" messages into React   │           │
│  │   │   trees (CommandPalette, SidebarPanel, MdRender)  │           │
│  │   └── translate user events back to the plugin        │           │
│  └───────────────────────────────────────────────────────┘           │
│                              ▲                                       │
│                              │ postMessage                           │
│                              ▼                                       │
│  ┌────────────── Web Worker (per plugin) ────────────────┐           │
│  │  - imports the plugin entry module                    │           │
│  │  - calls definePlugin(manifest, handlers)             │           │
│  │  - receives action events from the host               │           │
│  │  - emits patch / render messages back                 │           │
│  │  NO DOM. NO localStorage. NO direct vault access.     │           │
│  └───────────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────────┘
```

Why this and not the alternatives:

- Same-context JS (Obsidian's model): plugin can read localStorage,
  steal the user's GitHub OAuth token, and exfiltrate the entire
  vault. Disqualifying for a browser app where the token lives in
  localStorage.
- Plain iframe sandbox: workable but plugin developers must ship
  both HTML and JS, the postMessage protocol has to render
  arbitrary plugin HTML, and composing plugin UIs onto noteser's
  Tailwind theme is hard.
- Capability-mediated Worker: plugin writes pure JS. It declares
  what it wants (manifest), and the host renders. No raw HTML
  escapes the worker, which gives us a single XSS chokepoint
  rather than N.

## Plugin manifest

Every plugin's entry module exports a single `definePlugin` call:

```ts
import { definePlugin } from '@noteser/plugin-sdk'

export default definePlugin({
  // identity
  id: 'word-count',
  name: 'Word count',
  version: '1.0.0',
  author: 'jane@example.com',

  // declared capabilities (host enforces; unknown fields rejected)
  surfaces: {
    commands: [
      { id: 'wc.show', title: 'Word count: show', shortcut: 'Mod+Alt+W' },
    ],
    sidebarPanels: [
      { id: 'wc.panel', title: 'Word count', icon: 'document-text' },
    ],
    codeBlockRenderers: [],   // none for this plugin
  },

  // handlers (run in the Worker)
  onCommand(id, ctx) { … },
  onPanelMount(panelId, ctx) { … },
  onActiveNoteChange(note, ctx) { … },
})
```

The `ctx` object is the plugin's only door back into noteser. It
exposes a narrow capability set:

```ts
interface PluginCtx {
  // read only
  activeNote: { id, title, content } | null
  notes: ReadonlyArray<{ id, title, folderPath }>   // titles + paths only

  // render
  setPanelContent(panelId: string, virtualDom: VNode): void
  renderCodeBlock(blockId: string, virtualDom: VNode): void

  // emit
  notify(message: string): void
  insertText(text: string): void   // into active editor at cursor

  // settings
  getSetting<T>(key: string): T | undefined
  setSetting<T>(key: string, value: T): void   // namespaced to plugin id
}
```

What `ctx` does NOT expose, on purpose:

- The GitHub OAuth token. Plugins never see it.
- Note BODIES of notes other than the active one (would let a plugin
  exfiltrate the whole vault on first install). Names + paths only.
- Direct DOM. Renders go through a small JSX-like virtual DOM that
  the host maps to a curated component set (text, link, button,
  inputs, lists). No `<script>`, no `<style>`, no `dangerouslySetInnerHTML`.
- Network: NO `fetch` in v1. (Future v2 may allow with explicit
  per-domain permission grants.)

## Permission model

v1 is permissionless because the capability set is narrow enough. The
plugin can only do what `ctx` exposes; the worker has no DOM, no
network, no localStorage.

When v2 widens the surface (custom export, sync hooks, fetch),
permissions become a manifest field:

```ts
permissions: ['vault.read.all', 'network.fetch', 'sync.export']
```

The user grants per-permission at install time.

## Plugin install + discovery

v1 ships two install paths:

1. **URL paste.** User opens Settings → Plugins → "Add plugin" →
   pastes a URL to the plugin's `manifest.json` (which references a
   `main.js`). Host fetches both, hashes the bundle, shows the
   manifest summary, asks the user to confirm. Bundle stored in
   IndexedDB.

2. **Vault folder.** A `.noteser/plugins/<plugin-id>/` folder in the
   user's GitHub repo. Host scans this folder on vault load. Same
   confirmation flow. Lets a power user version-control their
   plugins alongside their notes.

Plugin discovery in v1 is a curated GitHub list at
`github.com/ipapakonstantinou/awesome-noteser`. Real registry
(searchable, ratings) is v2.

## Plugin SDK

Published as `@noteser/plugin-sdk` on npm. Provides:

- TypeScript types for the manifest, the `PluginCtx`, the virtual
  DOM nodes.
- The `definePlugin` factory (just a passthrough; runtime validation
  happens host-side).
- A tiny `h` / JSX helper so plugin authors can write
  `<panel><button>…</button></panel>` and the host maps to React.

## Dev workflow

For plugin authors:

```
npm create @noteser/plugin
cd my-plugin
npm install
npm run dev    # vite watcher, writes dist/main.js
```

The author opens noteser, Settings → Plugins → "Add plugin from URL",
pastes `http://localhost:5173/manifest.json`. The host has a "dev
mode" toggle that allows http URLs and skips the integrity hash check
in development.

Hot reload: on file save, vite writes a new bundle; the host's
PluginHost detects the new etag and restarts the Worker. No app
reload needed.

## Phases

- **Week 1 — API design + host scaffolding.**
  Manifest schema (zod). PluginHost class. Worker bridge with
  postMessage. NO surface adapters yet. Three contract tests:
  manifest validates, worker boots, ping/pong round-trips.

- **Week 2 — Surface adapters.**
  CommandPalette adapter (plugin commands appear in Ctrl+P). Sidebar
  panel adapter (the existing sidebar panel registry takes plugin
  entries). Code-block renderer adapter (the markdown live-preview
  + read-mode renderer maps unknown fence languages to the plugin
  registry).

- **Week 3 — Install + settings UI.**
  Settings → Plugins panel: list installed, add by URL, enable /
  disable / uninstall. URL-paste install flow with manifest preview
  + confirmation modal. Vault-folder scan (.noteser/plugins).
  IndexedDB storage of bundles.

- **Week 4 — SDK + starters + docs.**
  Publish `@noteser/plugin-sdk` to npm. Ship two reference plugins:
  `noteser-mermaid` (code-block renderer for ` ```mermaid `) and
  `noteser-word-count` (sidebar panel). Add /docs/plugins page in
  the existing help system covering API, install, dev workflow,
  examples.

- **Week 5 — OPTIONAL — awesome-noteser registry.**
  GitHub repo with a curated list. README + contribution guidelines.

## Security review checklist (before week 4 lands)

- [ ] Worker has no DOM access (verified by integration test that
  tries to access `document` and gets `undefined`).
- [ ] `ctx.notes` returns titles + paths only, never bodies, for
  non-active notes (verified by golden test).
- [ ] Virtual-DOM-to-React mapping rejects `<script>`, `<style>`,
  `dangerouslySetInnerHTML`, `on*` event handler attributes (verified
  by malicious-plugin fuzz test).
- [ ] Plugin bundle URL must be HTTPS (except in dev mode).
- [ ] Manifest integrity hash recorded + checked on every load.
- [ ] User confirmation required on first install of each plugin.
- [ ] One CSP audit pass before shipping (the Worker must NOT be
  excepted from the existing nonce CSP).

## Open questions for Jon

1. Should the SDK be MIT or AGPL-licensed? (noteser core is MIT;
   does the plugin SDK match?)
2. Should we curate the awesome-noteser list, or let it be community-
   moderated from day one? Curated == quality signal, community ==
   scale.
3. Mermaid renderer — fine to depend on the `mermaid` npm package
   (huge, ~600 KB), or do we ship a smaller subset?
4. Naming: `@noteser/plugin-sdk` vs `noteser-plugin` vs `noteser-sdk`?
5. Should plugins be allowed to use their own React components in
   v1 (we ship a curated component set), or in v2 only?

## Out-of-scope but worth noting

- A "plugin store" UI inside noteser itself (browse, install with one
  click). Defer to v2; v1 just has URL paste.
- Per-vault plugin lists. v1 installs are global per browser. Per-
  vault config can live in `.noteser/plugins/` later.
- iOS plugin support. Workers run fine on iOS Safari, but the dev
  flow (vite, npm) is not realistic on a phone. v1 says "plugins are
  a desktop experience" explicitly.

---

Next step once approved: I open `feat/plugins-v1` and start week 1
(host scaffolding + worker bridge + contract tests). Each week lands
as a single PR onto that branch; we promote the whole thing to dev
at the end of week 4.
