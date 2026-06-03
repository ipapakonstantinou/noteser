# @noteser/plugin-sdk

TypeScript SDK for writing [Noteser](https://noteser.app) plugins.

## Install

```bash
npm install @noteser/plugin-sdk
```

## Quick start

```ts
import { definePlugin } from '@noteser/plugin-sdk'

export default definePlugin({
  id: 'word-count',
  name: 'Word count',
  version: '1.0.0',
  surfaces: {
    sidebarPanels: [{ id: 'panel', title: 'Word count' }],
  },
  onPanelMount(panelId, ctx) {
    const words = (ctx.activeNote?.content ?? '').split(/\s+/).filter(Boolean).length
    ctx.setPanelContent(panelId, { tag: 'text', value: `${words} words` })
  },
  onActiveNoteChange(note, ctx) {
    const words = (note?.content ?? '').split(/\s+/).filter(Boolean).length
    ctx.setPanelContent('panel', { tag: 'text', value: `${words} words` })
  },
})
```

Bundle the plugin to a single `main.js` ES module, host the bundle +
`manifest.json` at any HTTPS URL, then in Noteser open Settings →
Plugins → paste the manifest URL.

## What plugins can do (v1)

Three surfaces:

1. **Commands.** Appear in the command palette (Ctrl+P). Running a
   command calls your `onCommand` handler in the plugin Worker.
2. **Sidebar panels.** A new section inside the sidebar's "Plugins"
   tab. Your `onPanelMount` runs when the user opens it; your
   `setPanelContent` updates its display.
3. **Code-block renderers.** Claim a fenced-code language (e.g.
   ` ```chart `) and your `onRenderCodeBlock` runs for every fenced
   block in that language.

## What plugins cannot do (v1)

By design, your plugin code runs in an isolated Web Worker. It has:

- No DOM access
- No `localStorage` access
- No knowledge of the user's GitHub token
- No `fetch` (v2 may add it with explicit per-domain permissions)
- No access to the **bodies** of notes other than the currently-open
  one (it can read titles + folder paths of every note, that is all)

## License

MIT. See [LICENSE](./LICENSE) for full text.

## Status

v0.1.0. The plugin platform itself is still maturing inside Noteser;
the SDK surface above is the stable v1 shape and should not break in
patch releases. See [docs/plugins-plan.md](https://github.com/ipapakonstantinou/noteser/blob/main/docs/plugins-plan.md)
in the Noteser repo for the long-form design + the v2 roadmap.
