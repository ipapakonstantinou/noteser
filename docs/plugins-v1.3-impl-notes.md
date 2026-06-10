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
