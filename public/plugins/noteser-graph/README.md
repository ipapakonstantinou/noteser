# noteser-graph

Reference plugin that delivers the graph view + backlinks panel called for
in issue #71. Built on the Plugin API v1.2 (PRs A, B, C, F + the post-v1.2
VNode event delivery / wikilink intercept follow-up) and the v1.3
interaction surface (L1-L4: pointer / wheel / hover events, host-owned
pan/zoom with the `surface.transform` settle event, and the
`worker:patchSvgPositions` position-patch fast path). Self-contained ES
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
- Header buttons: Recompute, Reset view, and (when any node is pinned)
  Release pinned.

#### Interactive (v0.3.0, "G2-G5")

The graph uses the v1.3 interaction surface to feel like Obsidian:

- **Wheel zoom + drag pan (G2).** The svg declares `panZoom: 'host'`, so
  the host owns the viewBox: wheel-zoom and dragging the background pan
  instantly with no worker round-trip. On gesture settle the host emits
  one `surface.transform` event `{ x, y, scale }`; the plugin
  reconstructs the viewport box from it and persists it under
  `g2.viewport`, so the viewport survives a reload. The old nine
  zoom/pan buttons are gone.
- **Node drag, pin/unpin (G3).** Pressing a node circle pins it (the
  host auto-captures the pointer because the circle declares both
  `onPointerDown` and `onPointerMove`); moving the pointer drags the
  pinned node to `payload.{x,y}` (already svg user-space). The
  simulation reheats around pinned nodes (`simulationStep` skips
  integration for `fixed` nodes) and streams ONLY the moved coordinates
  through `ctx.patchSvgPositions({ viewId, patches })` each frame, so a
  500-node drag never re-emits the whole SVG tree. A pinned node keeps a
  distinct ring; click a pinned node to unpin it, or use "Release
  pinned".
- **Hover highlight (G4).** Hovering a node (`onPointerEnter`) dims every
  non-neighbour circle to a muted fill and brightens/thickens the hovered
  node's edges; `onPointerLeave` clears it. The highlight is recolor-only
  (no re-layout, no patch channel).
- **Click vs drag to open (G5).** A press that releases within ~4px and
  ~250ms counts as a click, not a drag: a click on a free note node
  selects it and surfaces the open link; a click on a pinned node unpins
  it. A real drag never opens the note. Opening still flows through the
  host's `wikilink://` intercept on the selected-row `link` (see the API
  note below).

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
`g1.search`, `g1.hideOrphans`, `g1.tagsAsNodes`, `g1.forces`, and the
G2 viewport box `g2.viewport`.

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

## What v1.3 closed, and the one gap that remains

The v1.2 surface could not express wheel-zoom, drag-pan, node drag, or
hover, so v0.1.0 / v0.2.0 shipped zoom/pan as header buttons and a
two-click "select then open" flow. The v1.3 interaction surface closes
the interaction gaps:

- `onWheel` + `panZoom: 'host'` -> wheel zoom + drag pan (the buttons
  are gone).
- `onPointerDown / Move / Up` on circles + automatic pointer capture ->
  node drag.
- `worker:patchSvgPositions` (`ctx.patchSvgPositions`) -> 60fps drag
  without re-emitting the SVG tree.
- `onPointerEnter / Leave` -> hover highlight.

One gap remains: `PluginCtx` still exposes **no `ctx.openNote(id)`**
method, and SVG children cannot be wrapped in a `link` VNode. The only
way to open a note from a plugin is a real `<a>` click on a `link`
VNode with `href: { kind: 'note', noteId }`, which the host's
`wikilink://` intercept turns into `useWorkspaceStore.openNote`. So G5
here is the click-vs-drag DISAMBIGUATION plus surfacing that open link
on a genuine click; a true single-click programmatic open would need a
future `ctx.openNote(id)` host method. This plugin does not (and may
not) reach into `src/plugins` to add one.

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

The G2-G5 interactive increment adds more pure helpers, all exported and
unit-tested:

- `isTapGesture(start, end, opts?)` / `TAP_MOVE_THRESHOLD` /
  `TAP_TIME_THRESHOLD` - click-vs-drag classification.
- `simulationStep(sim, edges, opts?)` / `simIsSettled(sim, threshold?)` -
  one live integration step honouring the per-node `fixed` flag.
- `hoverNeighbours(edges, hoveredId)` / `edgeKey(source, target)` - the
  hover highlight node + incident-edge sets.
- `viewportFromTransform(base, transform)` / `clampViewport(vp)` /
  `DEFAULT_VIEWPORT` - the `surface.transform` viewport round-trip.

Jest tests at `src/__tests__/noteserGraphPlugin.test.ts`,
`src/__tests__/noteserGraphPluginG1.test.ts`, and
`src/__tests__/noteserGraphPluginG2G5.test.ts` import the plugin module
directly. The first covers the unlinked-mention detector plus graph
derivation; the second covers tag extraction, the tags-as-nodes
synthesis, the local-graph BFS, orphan filtering, color assignment, and
force clamping/tuning; the third covers the click-vs-drag threshold,
pinned-node handling in the simulation step, the hover neighbour set,
and the viewport persistence round-trip.
