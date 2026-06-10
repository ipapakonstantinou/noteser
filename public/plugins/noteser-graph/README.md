# noteser-graph

Reference plugin that delivers the graph view + backlinks panel called for
in issue #71. Built on the Plugin API v1.2 (PRs A, B, C, F + the post-v1.2
VNode event delivery / wikilink intercept follow-up). Self-contained ES
module - the worker dynamic-imports `main.js` via a Blob URL.

## What it provides

### Sidebar panel "Graph"

Shown for the active note. Two sections plus an action button:

- **Backlinks** - every other note whose body contains a `[[Title]]`
  wikilink that resolves (case-insensitive) to the active note's title.
- **Unlinked mentions** - every other note that contains the active note's
  title as plain text, with these exclusions:
  - inside existing `[[wikilinks]]`
  - inside fenced code blocks (triple backticks)
  - inside inline code spans (single backticks)
  Match is whole-word and case-insensitive.
- **Open global graph** button at the bottom opens the fullscreen view.

### Fullscreen view "Graph"

Force-directed SVG of the vault.

- Nodes are notes; edges are wikilinks.
- Click a node to "select" it. The header shows a `link` VNode pointing
  at that note (`{ kind: 'note', noteId }`); clicking the link goes
  through the host's `wikilink://` intercept and opens the note. Tag
  nodes (see below) are not notes, so selecting one shows a plain label.
- Header buttons: Recompute, Reset view, Zoom in / out, Pan in four
  directions.

#### Graph richness controls (v0.2.0, "G1")

A control panel above the canvas. Every choice persists via
`setSetting` under the `g1.` namespace, so it survives a reload.

- **View** - Global graph, or a Local graph: the neighbourhood of the
  active note reached by BFS over the wikilink edges, at a depth of 1,
  2, or 3 hops. The local graph re-derives when the active note
  changes while the view is open.
- **Color groups** - color every node by folder, by first tag, or by a
  highlight query (notes whose title or body match the query turn
  green). Folder and tag colors come from a fixed palette keyed by a
  hash, so the same folder keeps the same color across reloads.
- **Filters**
  - A search box dims every node whose title or body does not match.
  - "Hide orphans" drops degree-0 nodes before layout.
  - "Show tags as nodes" adds one synthetic node per distinct tag with
    an edge from each note to its tags. Off by default.
- **Forces** - number inputs for center force, repel strength, link
  force, link distance, and a node size multiplier, with a
  "Reset forces" button. The four physics values feed the simulation;
  the size multiplier scales the by-degree node radius. All values are
  clamped to safe ranges so a stray entry cannot break the layout.

Changing a color or filter setting repaints without re-running the
simulation; changing the view mode, depth, force values, or a node
toggle re-derives the graph and re-runs the layout.

Setting keys: `g1.mode`, `g1.depth`, `g1.colorBy`, `g1.colorQuery`,
`g1.search`, `g1.hideOrphans`, `g1.tagsAsNodes`, `g1.forces`.

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

- `vault.read.all` - needed to scan every note's body for wikilinks
  and unlinked mentions. The plugin uses `getAllNotes()` for the
  current vault size and falls back to `stream({ chunkSize: 200 })`
  when the host reports "Vault too large".
- `vault.events` - re-derives the panel + graph when a note saves or
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
  + spring attraction + center pull, with an adaptive iteration
  count (220 for small graphs, 40 for 1 k nodes, 25 above that) so
  the open budget stays in reach without Barnes-Hut. Measured on
  the worktree: derive ~6 ms, simulate ~400 ms for 1 000 nodes /
  3 000 edges.

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
   field already does - wire the alias scanner across).
3. **Delete the core view.** Remove `src/components/sidebar/BacklinksView.tsx`
   and its right-sidebar registry entry once the plugin handles aliases.
   The core `findBacklinks(notes, target)` helper in
   `src/utils/backlinks.ts` stays for now - it backs internal tooling
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

The G1 increment adds more pure helpers, all exported and unit-tested:

- `extractTagsInline(body)`
- `deriveTagGraph(base, notes)` / `tagNodeId(name)`
- `bfsNeighbourhood(edges, rootId, depth)`
- `subgraphForIds(graph, idSet)` / `localGraph(graph, rootId, depth)`
- `dropOrphans(graph)` / `recomputeDegree(nodes, edges)`
- `noteMatchesQuery(note, query)`
- `computeNodeColors(nodes, notesById, opts)` / `colorForKey(key)`
- `clampForces(forces)` / `DEFAULT_FORCES`

Jest tests at `src/__tests__/noteserGraphPlugin.test.ts` and
`src/__tests__/noteserGraphPluginG1.test.ts` import the plugin module
directly. The first covers the unlinked-mention detector (code-block
exclusion, wikilink exclusion, whole-word matching) plus graph
derivation on a 5-note fixture; the second covers tag extraction, the
tags-as-nodes synthesis, the local-graph BFS, orphan filtering, color
assignment, and force clamping/tuning.
