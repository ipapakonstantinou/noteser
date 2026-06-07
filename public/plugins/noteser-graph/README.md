# noteser-graph

Reference plugin that delivers the graph view + backlinks panel called for
in issue #71. Built on the Plugin API v1.2 (PRs A, B, C, F + the post-v1.2
VNode event delivery / wikilink intercept follow-up). Self-contained ES
module — the worker dynamic-imports `main.js` via a Blob URL.

## What it provides

### Sidebar panel "Graph"

Shown for the active note. Two sections plus an action button:

- **Backlinks** — every other note whose body contains a `[[Title]]`
  wikilink that resolves (case-insensitive) to the active note's title.
- **Unlinked mentions** — every other note that contains the active note's
  title as plain text, with these exclusions:
  - inside existing `[[wikilinks]]`
  - inside fenced code blocks (triple backticks)
  - inside inline code spans (single backticks)
  Match is whole-word and case-insensitive.
- **Open global graph** button at the bottom opens the fullscreen view.

### Fullscreen view "Graph"

Force-directed SVG of the whole vault.

- Nodes are notes; edges are wikilinks.
- Click a node to "select" it. The header shows a `link` VNode pointing
  at that note (`{ kind: 'note', noteId }`); clicking the link goes
  through the host's `wikilink://` intercept and opens the note.
- Header buttons: Recompute, Reset view, Zoom in / out, Pan in four
  directions.

## Install + dev workflow

```
npm run dev                 # serves http://localhost:3001
```

Then in Noteser:

1. Settings -> Plugins -> Add plugin
2. Paste `http://localhost:3001/plugins/noteser-graph/manifest.json`
3. Confirm the permissions: `vault.read.all` and `vault.events`.
4. Open any note. The "Graph" panel appears in the right sidebar.

The host's plain-HTTP install path is gated on `localhost` only (dev
mode); production installs require HTTPS.

## Permissions

- `vault.read.all` — needed to scan every note's body for wikilinks
  and unlinked mentions. The plugin uses `getAllNotes()` for the
  current vault size and falls back to `stream({ chunkSize: 200 })`
  when the host reports "Vault too large".
- `vault.events` — re-derives the panel + graph when a note saves or
  when the active note changes. The host debounces every event at
  250 ms, so a burst of keystrokes collapses to one re-derive.

The plugin caches the vault snapshot keyed by a 32-bit FNV-1a hash
over `(id, updatedAt)` pairs. A second `getAllNotes()` against the
same SHA returns from cache without re-asking the host.

## Performance budget

- **Panel re-derive on note switch:** target under 50 ms for a 5 k-note
  vault. The plugin logs `[noteser-graph] panel derive: <ms>` to the
  worker console on every re-derive; check the devtools console to
  verify the budget on your own vault.
- **Graph layout open:** target under 500 ms for 1 k nodes. The plugin
  logs `[noteser-graph] graph layout: derive=<ms> simulate=<ms>` on
  every rebuild. The force simulator is hand-rolled O(n^2) repulsion
  + spring attraction + center pull at 220 iterations; Barnes-Hut is
  not required at this scale.

## Co-existence with core BacklinksView

The core `src/components/sidebar/BacklinksView.tsx` keeps shipping for
now. The two surfaces overlap on backlinks; only this plugin adds
unlinked mentions and the global graph view.

### Swap plan

Once this plugin ships and ride-along telemetry confirms parity with
the core view, the swap is:

1. **Default-install the plugin.** Bundle `noteser-graph` into the
   first-run plugin set so a brand-new vault has both surfaces by
   default.
2. **Wire alias support into the plugin.** The core BacklinksView
   honours `getAliasesForNote(note)` from `src/utils/aliases.ts`. The
   plugin currently matches on title only; surface aliases via a
   future `vault.read.all` enrichment that exposes parsed
   frontmatter consistently (the existing `NoteWithBody.frontmatter`
   field already does — wire the alias scanner across).
3. **Delete the core view.** Remove `src/components/sidebar/BacklinksView.tsx`
   and its right-sidebar registry entry once the plugin handles aliases.
   The core `findBacklinks(notes, target)` helper in
   `src/utils/backlinks.ts` stays for now — it backs internal tooling
   (e.g. the sync layer's "broken link" check).

The plugin's panel id (`graph`) intentionally does not collide with the
core's `backlinks` id, so a user can have both panels installed without
the registry rejecting either.

## v1.2 API gaps surfaced while building

The brief asked for:

- **Wheel = zoom** on the graph view, and
- **Drag = pan** on the graph view, and
- **Click a circle = open the note in one click**.

The v1.2 VNode event set is restricted to `onClick`, `onChange`,
`onSubmit`, and `onKeyDown` (the last only for Esc / Enter). There is
no `onWheel`, no `onPointerDown / move / up`. SVG children
(`circle` / `rect`) accept `onClick` only, so dragging the canvas to
pan and wheel-to-zoom are not expressible at the VNode layer.

Likewise, the host's `wikilink://` intercept fires on real `<a>`
elements rendered from a `link` VNode. SVG children cannot be wrapped
in a `link` VNode (the SvgChild union does not allow it), and the
`PluginCtx` exposes no `ctx.openNote(id)` method. Clicking a circle
therefore lands as a regular VNode event, and the plugin has to
re-render with a `link` VNode the user clicks to actually navigate.

To preserve the brief's spirit, this plugin ships:

- **Zoom in / out + Pan four-direction buttons** in the header instead
  of wheel + drag.
- **Two-click open** for circle clicks (click circle -> persistent
  "Selected" `link` row appears in the header -> click link to open).

A v1.3 API increment that lands `onWheel` / pointer events on the SVG
shape and an `ctx.openNote(id)` method would close both gaps without
breaking this plugin's UI.

## Tests

Pure derivation logic lives in `main.js` as named exports:

- `extractWikilinks(body)`
- `maskCodeAndWikilinks(body)`
- `findUnlinkedMentions(body, title)`
- `findUnlinkedMentionsAcross(notes, targetId, targetTitle)`
- `findBacklinks(notes, targetId, targetTitle)`
- `deriveGraph(notes)`
- `snapshotSha(notes)`
- `runForceSimulation(nodes, edges, opts?)`

Jest tests at `src/__tests__/noteserGraphPlugin.test.ts` import the
plugin module directly and cover the unlinked-mention detector
(code-block exclusion, wikilink exclusion, whole-word matching) plus
graph derivation on a 5-note fixture.
