# Plugin API v1.3 — implementation notes

Companion to `docs/plugins-v1.3-plan.md`. Records what each platform PR
actually shipped and any deviation from the plan.

## L1 — pointer events + interaction manifest opt-in + rAF coalescing

PR branch: `feat/plugins-v1.3-pointer-events`. Scope is pointer events
ONLY. Wheel (L2), hover (L3), host-owned pan/zoom + `surface.transform`
(L2), and the position-patch channel `worker:patchSvgPositions` (L4) are
deliberately out of scope and untouched here.

### What shipped

- **New VNode handler props** (`src/plugins/PluginVNode.tsx`). A
  `PointerHandlers` subset — `onPointerDown` / `onPointerMove` /
  `onPointerUp` — plus an optional `id` on: SvgChild `circle` + `rect`,
  the surface-level `VNodeSvg`, and `VNodeBox`. Listeners attach only
  when the corresponding prop is present, so a v1.2 node attaches
  nothing (zero cost). `onPointerEnter` / `onPointerLeave` and
  `onWheel` from the plan's interface sketch are NOT added — they belong
  to L3/L2.
- **Payload contract.** `PointerEventPayload { x, y, button, pointerId,
  target }`. Host keys win the shallow merge over any plugin payload, so
  coords / target / pointerId cannot be spoofed. Only numbers + the
  echoed `target` string cross the wire — no DOM ref, no event object.
  `button` is the real button on down/up and forced to `-1` on move.
- **Coordinate mapping.** One chokepoint, `dispatchPointer`, sibling of
  `dispatchOrDrop`. SVG surfaces map client coords to user space via the
  inverse screen CTM (`getScreenCTM`), so coords survive viewBox
  pan/zoom; box surfaces use element-local pixels relative to the
  bounding rect.
- **Pointer capture.** When a shape declares BOTH `onPointerDown` and
  `onPointerMove`, the pointerdown listener calls
  `setPointerCapture(pointerId)` so move/up keep firing during a drag.
  Best-effort (wrapped in try/catch — jsdom and some browsers throw on
  an inactive pointer); the plugin never sees it.
- **Manifest opt-in** (`src/plugins/manifest.ts`).
  `PluginSurfaceInteraction { pointer?, wheel?, hover? }`, optional on
  `PluginFullscreenView` and `PluginSidebarPanel`. The validator
  shape-checks it and rejects unknown sub-keys (matches the v1.2 "no
  silent capability gap" rule). It is NOT a `PERMISSIONS` entry. The
  install-preview modal adds one line — "This view responds to mouse
  drag, wheel, and hover." — under any surface that declares interaction.
- **rAF coalescing + HF budget** (`src/plugins/PluginHost.ts`).
  `sendVNodeEvent` gained an optional `{ highFrequency }` flag. High-
  frequency events (only `onPointerMove` in L1) are coalesced latest-
  wins keyed by `(pluginId, event-name, target)` and flushed one per key
  per animation frame. They draw from a SEPARATE budget
  `MAX_HF_EVENTS_PER_SECOND = 90` and never consume the discrete
  `MAX_VNODE_EVENTS_PER_SECOND = 16`. `onPointerDown` / `onPointerUp`
  are discrete and bypass coalescing. The HF path is gated on the
  surface's `interaction.pointer` opt-in: a surface that did not opt in
  drops HF events on the floor (and never schedules a frame).

### Deviations / decisions

1. **Plan said "keyed by (pluginId, event, target)" but the event name
   on the wire is plugin-defined**, so the host cannot classify an event
   as high-frequency from the name alone. Resolved by having the
   renderer (which DOES know the DOM event) tag pointermove dispatches
   with `highFrequency: true` on `PluginVNodeEvent`; the three surface
   adapters forward that flag into `sendVNodeEvent`. The coalescing key
   is still `(pluginId, event-name, target)` exactly as specified — the
   flag only tells the host which budget/path to use.
2. **HF budget is charged at flush time, not enqueue time.** Coalescing
   already collapses a burst of moves to one-per-frame per key; charging
   the 90/sec budget per enqueued move would exhaust it instantly and
   defeat the coalescing. Charging per flushed event makes 90/sec a real
   ceiling on delivered events.
3. **Coordinate inverse is computed by hand** (`inverseCTMPoint`) from
   the CTM's `a..f` entries rather than via `DOMPoint.matrixTransform`,
   so the mapping is a pure, unit-testable function and survives jsdom
   (which returns `null` from `getScreenCTM`). When the CTM is absent or
   degenerate the raw client point is returned so the contract
   (finite numbers, never throwing) holds.
4. **Discrete pointer events are NOT gated on the interaction opt-in** —
   only the high-frequency path is, per plan section 2.5 ("gates the
   high-frequency budget + rAF coalescing"). A plugin that wires
   pointerdown/up without declaring interaction still gets those events
   through the normal discrete budget. Declaring `interaction.pointer`
   is what unlocks smooth dragging (the coalesced move stream).
5. **Frame scheduler is injectable** (`PluginHostOptions.requestFrame`)
   so tests flush coalesced events deterministically. Production falls
   back to `requestAnimationFrame`, then `setTimeout(…, 16)`.

### Files touched outside `src/plugins/` + `src/components/plugins/`

The guardrail was "only touch `src/plugins/`, `src/components/plugins/`,
tests, and this doc." Three files just outside that list were touched
for required reasons (the `noteser-graph` plugin track was NOT touched):

- `src/components/modals/PluginInstallConfirmModal.tsx` — required by the
  task itself: add the one interaction line to the install preview.
- `src/components/sidebar/PluginsPanel.tsx` and
  `src/components/editor/PluginCodeBlock.tsx` — the other two surface
  adapters (the first, `PluginFullscreenView`, IS in
  `src/components/plugins/`). Each gained a one-line forward of the
  `highFrequency` flag into `sendVNodeEvent` so all three surfaces route
  pointermove through the coalescing path consistently. Without it a
  panel/code-block pointermove would wrongly take the discrete budget.

### Not done (later PRs)

- L2: `onWheel`, host-owned pan/zoom, `surface.transform`.
- L3: `onPointerEnter` / `onPointerLeave` hover events.
- L4: `worker:patchSvgPositions` position-patch fast path.

## L2 + L3 + L4 — wheel, host pan/zoom, hover, position-patch channel

PR branch: `feat/plugins-v1.3-wheel-hover-patch`. Shipped together
because all three layers edit the same platform files (`PluginVNode.tsx`,
`PluginHost.ts`, `protocol.ts`, the surface adapters) and splitting them
would have meant three conflicting PRs over the same code. The
`noteser-graph` plugin (G2/G3/G4) is a separate PR and was NOT touched.

### What shipped

- **L2 wheel** (`PluginVNode.tsx`). `WheelHandlers { onWheel }` on
  `VNodeSvg` + `VNodeBox`. `WheelEventPayload { deltaX, deltaY, x, y,
  ctrlKey }`; x/y use the same surface mapping as pointer (svg user-space
  via inverse CTM, box element-local). Wheel is high-frequency → rides
  L1's coalescing, gated on `interaction.wheel`.
- **L2 host-owned pan/zoom** (`PluginVNode.tsx`). `VNodeSvg.panZoom:
  'host'`. The host owns the viewBox: drag-pan (surface-level pointer)
  and wheel-zoom mutate the rendered `<svg>` viewBox attribute DIRECTLY
  via a ref (no worker round-trip, no React re-render), and on settle
  (pointerup, or a 150ms wheel-idle debounce) emit exactly ONE
  `surface.transform` event `{ x, y, scale }`.
- **L3 hover** (`PluginVNode.tsx`). `onPointerEnter` / `onPointerLeave`
  added to `PointerHandlers` (so they land on circle, rect, svg, box).
  `HoverEventPayload { target, x, y }`. High-frequency → coalesced,
  gated on `interaction.hover`.
- **L4 position-patch** (`protocol.ts`, `PluginHost.ts`,
  `svgPositionPatch.ts`, surface adapters, `workerEntry.ts`, `sdk.ts`).
  New worker→host envelope `worker:patchSvgPositions { viewId?, panelId?,
  patches: {id,x,y}[] }` in the `WorkerToHost` union + `isWorkerToHost`.
  Host sanitises + emits a `svgPositionsPatch` PluginHostEvent; the
  surface adapters apply patches to the mounted svg by mutating
  `cx`/`cy` on circles + the matching endpoint of connected edge lines,
  with no React re-render. New SDK method `ctx.patchSvgPositions(...)`.

### Deviations / decisions

1. **Per-kind HF gating, not a single pointer flag.** L1's
   `surfaceHasPointerInteraction` only checked `interaction.pointer`, and
   the wire event name is plugin-opaque so the host cannot tell pointer
   from wheel from hover by name. Resolved by adding `interaction?:
   'pointer'|'wheel'|'hover'` (`InteractionKind`, defined in
   `protocol.ts`) to `PluginVNodeEvent` and to the `sendVNodeEvent`
   options. The renderer tags each HF dispatch with its kind; the host's
   renamed `surfaceHasInteraction(manifest, source, kind)` checks the
   matching sub-flag. An HF event with no kind defaults to `'pointer'`,
   so L1's existing dispatches + tests are unchanged. The three surface
   adapters forward the new `interaction` field alongside
   `highFrequency`.
2. **`surface.transform` is a reserved event NAME on the existing
   `host:vnodeEvent` envelope, not a new envelope** (per plan 2.8).
   Constant `SURFACE_TRANSFORM_EVENT` lives in `protocol.ts`. The
   RENDERER emits it (host-owned pan/zoom is host logic), not the plugin;
   it is discrete (one per settle), so it bypasses coalescing and never
   carries `highFrequency`.
3. **Wheel listeners are bound manually as non-passive** rather than via
   React's `onWheel`. React registers wheel passive and cannot
   `preventDefault`, so any surface that interprets the wheel (a plugin
   `onWheel` or host pan/zoom) needs a manual `addEventListener('wheel',
   …, { passive: false })`. This forced `renderSvg` and the wheel-bearing
   `renderBox` to render as real components (`PluginSvg` / `PluginBox`)
   so they can hold a ref + effect. A plain svg/box (no wheel, no
   panZoom) keeps the exact v1.2/L1 path and attaches no wheel listener
   — non-interactive surfaces still scroll the page normally.
4. **Host pan only starts on the svg background** (`e.target ===
   e.currentTarget`), so grabbing a draggable child circle pans nothing
   — node-drag and pan coexist. While `panZoom: 'host'` is active the
   svg's own surface-level pointer handlers are NOT forwarded to the
   plugin (the host consumes them for panning); child-shape handlers
   still fire. `touchAction: none` is set so touch-drag pans instead of
   scrolling.
5. **Edge lines opt into the patch path via `sourceId` / `targetId`** on
   the `line` SvgChild — the renderer stamps `data-edge-source` /
   `data-edge-target` (and `data-node-id` on circles). The patch helper
   (`svgPositionPatch.ts`) builds the id→element map by WALKING those
   `data-*` attributes, never by feeding a plugin-controlled id into a
   selector, so a hostile node id cannot inject a querySelector. The map
   is rebuilt per patch batch, which is inherently "refreshed when the
   tree re-renders."
6. **Oversized patch rejection reuses the existing envelope-size guard.**
   `worker:patchSvgPositions` is subject to `MAX_ENVELOPE_BYTES` like
   every other message (the size check in `handleWorkerMessage` runs
   before the type switch), so an oversized batch is rejected with the
   generic "Envelope too large" workerError. The host additionally
   sanitises the patch shape (drops non-string ids / non-finite coords)
   before emitting the event.

### Files touched outside `src/plugins/` + `src/components/plugins/`

- `src/components/sidebar/PluginsPanel.tsx` and
  `src/components/editor/PluginCodeBlock.tsx` — forward the new
  `interaction` field into `sendVNodeEvent` (mirror of L1's
  `highFrequency` forward). `PluginsPanel` also applies L4 position
  patches to the matching panel section via `applySvgPositionPatches`.
  (`PluginFullscreenView`, the primary interactive surface, IS in
  `src/components/plugins/` and gained the same patch wiring.)
