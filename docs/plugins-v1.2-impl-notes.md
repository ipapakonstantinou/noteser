# Plugin API v1.2 — implementation notes

Companion doc to `docs/plugins-v1.2-plan.md`. One section per PR in
the six-PR plan (section 12 of the plan). Each section records the
deviations from the design plan, the rationale, and the follow-ups
the next PR in the sequence inherits.

The plan is authoritative; this file is the audit trail. If the two
disagree, the plan wins until a future PR explicitly updates it.

## PR A — VNode set extension

Lands the seven new shapes (`button`, `input`, `list`, `link`,
`radio`, `svg`, `box`) and the shared event-handler record. Follows
the plan section 2 exactly with the following clarifications.

### Sanitisation

The repo had no `escape-html` dependency at the time PR A landed.
PR A ships an inline escape (`escapeText` in
`src/plugins/PluginVNode.tsx`) that covers `&`, `<`, `>`, `"`, and
`'`. Every plugin-supplied string lands in a React children slot, so
React's default escape handles XSS for the rendered DOM; `escapeText`
exists as a named contract for future paths that build strings before
passing them to React (e.g. a debug renderer, a server-side preview).
No `dangerouslySetInnerHTML` anywhere in the renderer; a unit test
asserts the rendered HTML never contains the attribute for any v1.2
shape.

### Link href shape

The plan defines `VNodeLink.href` as a discriminated union
(`{ kind: 'note'; noteId }` or `{ kind: 'anchor'; fragment }`), and
PR A implements that union verbatim. The task brief mentioned an
alternative "wikilink:// or relative string, reject javascript:"
contract; that contract is enforced too, via `isSafePluginHref`, but
only as a belt-and-braces guard. The plugin never produces a raw href
string — the host constructs the real URL from the typed parts. The
named guard exists so a later opt-in raw-href shape can gate through
one chokepoint without re-deriving the unsafe-scheme list.

### Event wire

The renderer dispatches `PluginVNodeEvent` records (event name +
payload). Input and radio events augment the plugin-supplied payload
with `{ value }`; button and clickable svg events forward the payload
verbatim. The wire envelope `host:vnodeEvent` in `protocol.ts`
carries the same shape plus a `source` discriminator
(`panel` / `codeBlock` / `fullscreen`). PR A includes the
`fullscreen` variant in the type union so PR B does not need to
churn the protocol; PR A only ever emits `panel` and `codeBlock` at
runtime.

The handler-registration API (`ctx.onVNodeEvent`) is intentionally
NOT in PR A. The renderer's event dispatcher is currently wired only
in unit tests; the surface adapters (panel, code block) start
forwarding events to the worker in a later PR that also ships
`ctx.onVNodeEvent`. PR A ships the shape so PR B and the capability
PRs do not block on protocol churn.

### SDK exports

The in-repo SDK (`src/plugins/sdk.ts`) re-exports the VNode types
from `PluginVNode.tsx`. The published SDK
(`packages/noteser-plugin-sdk/src/sdk.ts`) inlines the type
declarations — it has no React dependency, so it cannot pull from the
renderer file. Both lists are kept aligned by review; a future PR may
extract the shared types into a `vdom.ts` shared between the two.

### List depth cap

`MAX_LIST_DEPTH = 8` per the plan (section 2.4). Both `list` and
`box` count toward the same depth budget — a nested chain of
`box → list → box → …` is rejected at depth 9, not depth 17. Simpler
contract for the renderer and tighter bound on React stack use.

### SVG colour parser

The plan specifies the colour regex
`/^(#[0-9a-f]{3,8}|rgb\(.*\)|rgba\(.*\)|[a-z]+)$/i` with a 32-char
cap. PR A tightens the `rgb`/`rgba` alternatives to `[^)]*` instead
of `.*` to keep the match anchored. Functionally equivalent for safe
inputs; rejects pathological strings like `rgb()) javascript:` that
the looser pattern would accept.

### Out-of-scope reminders for downstream PRs

- PR B (fullscreen) consumes the `HostVNodeEvent.source.fullscreen`
  variant already present in `protocol.ts`. No protocol change should
  be needed in B.
- PRs C / D / E / F MUST NOT add new VNode shapes. If a capability
  needs a new control, the discussion belongs in a v1.3 plan, not in
  a capability PR.
- The reference plugin under `public/plugins/noteser-vnode-demo`
  exercises every new shape but does not yet receive event callbacks
  (the registration API ships later). Once `ctx.onVNodeEvent` lands,
  update the plugin to read events and re-render.

## PR C — `vault.read.all` capability

Branch: `feat/plugins-v1.2-C-vault-read`. Lands the first v1.2 capability
(`vault.read.all`) under the plan's §4.1.

### As-built vs. plan

- **SDK return type for `getAllNotes` / `getNote`.** The plan signature is
  `Promise<ReadonlyArray<NoteWithBody>>` / `Promise<NoteWithBody | null>`.
  Shipped as written. The wire layer carries the same shape under
  `NoteWithBodyWire` for clarity at the protocol boundary; the SDK
  type alias collapses to `NoteWithBody` because the host-side parsed
  frontmatter is already a plain object.
- **`stream()` default chunk size.** Plan §5.1 documents the wire-level
  default as 200 and the cap as 500. PR C ships **default 100** (the
  scope spec called out 100 explicitly: "chunked 100 notes per chunk").
  Cap stays at 500 to match the plan's 256 KB envelope guard. Plugins
  can still request any size; the host clamps.
- **`getAllNotes` size guard.** Plan: reject when projected payload
  exceeds 4 MiB. Implemented as `MAX_GET_ALL_BYTES = 4 * 1024 * 1024`
  in `src/plugins/vaultSnapshot.ts`. `stream()` is always the
  recommended path for vault-wide reads.
- **Host snapshot cache.** Plan §3 (perf): "cache by vault-snapshot SHA
  so a second `getAllNotes()` call within the same SHA returns
  instantly." Implemented in `vaultSnapshot.ts` with an FNV-1a rolling
  hash over `(id, updatedAt)` pairs + folder ids. Not cryptographic —
  it's an identity key, not a security boundary.
- **Stream chunking + main-thread yield.** Plan §9: "must NOT block the
  main thread for >50ms even on 5000-note vaults." `streamVaultSnapshot`
  awaits a `queueMicrotask` between chunks, so a 5000-note walk at
  chunkSize=100 yields 50 times. The dominant cost (frontmatter parsing)
  happens once on the cache-cold call; subsequent calls reuse the cache.
- **Permission revocation persistence.** Plan §4 (each capability is
  revocable from Settings → Plugins). Implemented as a per-record
  `revokedPermissions` array on `InstalledPluginRecord`; the host
  re-applies it on each boot AND on each `confirmAndInstallPlugin`
  reload. In-memory revocation also writes through to the host so the
  next call rejects without waiting for a reload.
- **Mid-stream revocation.** Plan §5.3: "host emits a terminal chunk
  with `notes: []` and a non-empty `error`; worker rejects the
  AsyncIterable." Implemented in `pluginHostSingleton.handleVaultReadRequest`
  via `streamVaultSnapshot`'s `isAborted` polling — checked before
  every chunk emission.

### What this PR did NOT touch

Per the explicit scope guard rails:
- No `vault.write` (PR D).
- No `vault.events` (PR F).
- No `fs.openDirectory` (PR E).
- No new VNode set (PR A).
- The `ctx.vault.write`, `ctx.vault.events`, and `ctx.fs` namespaces are
  NOT populated by this PR — adding them here would split type defs
  across two PRs. The SDK `PluginCtx` type only gains `vault: { read: …}`;
  the sibling slots land with their respective PRs.

### Conflict expectations

- `src/plugins/protocol.ts`, `src/plugins/sdk.ts`, and
  `packages/noteser-plugin-sdk/src/sdk.ts` will conflict with PR A
  (VNode set) and PR D / E / F (other capabilities). Resolution rule:
  union types extend by line, so concatenate; the SDK `vault.read.*`
  methods are independent of `vault.write` and `vault.events` and can
  coexist on the `vault` namespace.
- `src/components/modals/PluginsSettingsPanel.tsx` grew a per-plugin
  permissions block. PR D will reuse the same block when it lands
  `vault.write` revocation; no schema change needed.

### Manual verification

The reference plugin at `public/plugins/noteser-vault-read-demo/`
exercises both `getAllNotes()` and `stream({ chunkSize: 50 })`. The
test plan: install from a local manifest URL, run "Vault read demo:
count notes" from the palette, confirm the toast reports the right
note count; revoke `vault.read.all` from Settings → Plugins, re-run,
confirm the toast reports the rejection.

## PR F — `vault.events` subscriptions

Plan reference: section 4.4, plus protocol additions in 5.1 / 5.2 and
SDK shape in 6.

### What landed

- Permission string `vault.events` added to `PERMISSIONS` /
  `PERMISSION_DESCRIPTIONS` in `src/plugins/manifest.ts`. Modal copy:
  "Listen for changes to the vault…".
- Wire protocol envelopes:
  - Worker → host: `worker:subscribeVault`, `worker:unsubscribeVault`.
  - Host → worker: `host:vaultChanged`, `host:noteSaved`,
    `host:activeNoteIdChanged`.
  - All three host envelopes carry the `subscriptionId` the worker
    minted, so the worker can pair the delivered event with the right
    in-worker handler.
- SDK addition: `ctx.vault.events.{onVaultChange, onNoteSaved,
  onActiveNoteChange}`, each returning an `Unsubscribe` thunk
  exported from the SDK package.
- Host implementation:
  - `PluginHost.notifyVaultChanged()`, `notifyNoteSaved(noteId)`,
    `notifyActiveNoteIdChanged(noteId)` walk every loaded plugin and
    schedule a debounced dispatch.
  - Debounce window centralised at `VAULT_EVENT_DEBOUNCE_MS` (250 ms)
    in `protocol.ts`. Per-event-type cap centralised at
    `MAX_VAULT_SUBSCRIPTIONS_PER_EVENT` (16); the worker enforces it
    synchronously when the plugin calls subscribe.
  - `pluginHostSingleton.wireVaultEvents()` wires the noteStore /
    folderStore / workspaceStore subscriptions:
    - Any noteStore or folderStore mutation calls
      `notifyVaultChanged()` (debounced 250 ms).
    - A noteStore mutation that changes a note's body / title /
      isDeleted (i.e. a save) calls `notifyNoteSaved(noteId)`
      (debounced 250 ms; ids coalesced per window via a `Set`).
    - A workspaceStore mutation that resolves to a different active
      noteId calls `notifyActiveNoteIdChanged(noteId)` (debounced
      250 ms; only the most recent id survives the window).

### Cleanup on unload

`PluginHost.unload()` now:

1. Cancels every in-flight debounce timer for the entry.
2. Clears the worker's vault-subscriptions map.
3. Calls `worker.terminate()` (existing v1.1 behaviour).

The leak test in `src/__tests__/plugins/vaultEvents.test.ts` mounts +
unloads a plugin 10 times and asserts `host.vaultSubscriptionCount()`
is 0 after each iteration. A leaked subscriber would surface as a
linear growth in that count and a failed assertion.

### Settings revocation

Reuses the `revokedPermissions: PluginPermission[]` field on
`InstalledPluginRecord` that PR C introduced. Settings → Plugins
already shows the per-permission toggle (PR C); PR F adds
`vault.events` to the list of permissions surfaced there.

`PluginHost.isVaultEventsAllowed(entry)` re-checks two sources on
every dispatch: the in-host `entry.plugin.revokedPermissions` set
(populated from PR C's boot wiring), and the optional
`opts.isPermissionRevoked` hook the test harness uses. A revocation
that lands during the debounce window suppresses delivery at flush
time, not just at schedule time.

The existing subscriber's `Unsubscribe` thunk is intentionally NOT
torn down by revocation. The plan calls this out: "toggle off makes
the subscription handler stop firing (but doesn't crash existing
subscribers; they just stop receiving events)". A re-grant
immediately restores delivery on the next signal — the host adds no
extra state for that path.

### Manifest-preview modal

`PERMISSION_DESCRIPTIONS['vault.events']` is the prose the modal
renders verbatim. The existing amber bullet renders without further
changes; `vault.events` is NOT flagged destructive (red).

### Reference plugin

`public/plugins/noteser-event-demo/` subscribes to all three event
types and toasts on each fire, stamping the event type in the
message. Useful for manually verifying debounce timing: rapid
keystrokes collapse to one `noteSaved` toast per 250 ms window.
Best-effort cleanup in `onPanelUnmount` calls every unsubscribe; the
host's automatic cleanup on terminate is the safety net.

### Deviations from the plan

- The plan describes `onVaultChange`'s payload as void; that matches.
  We coalesce `noteSaved` ids into a `Set<string>` at the host so a
  burst of saves on the same id fires the worker handler exactly
  once per debounce window. Different ids in the same window
  produce one worker dispatch per id (not one event with an array)
  — keeps the SDK signature `(noteId: string) => void` rather than
  `(noteIds: string[]) => void`.
- Settings revocation reuses PR C's `revokedPermissions` field on
  `InstalledPluginRecord` rather than introducing a separate grants
  store. Same outcome, half the state shape.

### Follow-ups for later PRs

- The graph view / backlinks plugin (#71) and AI plugins (#70) can
  now build their debounce-respecting invalidation flow on top of
  `vault.events` + PR C's `vault.read.all`.
- The 16-subscription cap is enforced worker-side. If a future
  capability adds host-side subscriptions outside the SDK, the cap
  should move into the host so the worker boundary stays the cap's
  enforcement point.

## PR E — `fs.openDirectory` capability

Plan reference: section 4.3.

### What shipped

- New permission `fs.open-directory` in
  `src/plugins/manifest.ts` (`PERMISSIONS` + `PERMISSION_DESCRIPTIONS`).
  The validator already rejected unknown permissions; the new value
  flows through unchanged. Mirrored in
  `packages/noteser-plugin-sdk/src/manifest.ts` so plugin authors
  building against the published SDK get type-level errors for
  unknown permission strings.
- New SDK surface `ctx.fs.openDirectory(args?: { extensions?: string[] })`
  returning `Promise<ReadonlyArray<{ name, path, blob }> | null>`.
  `null` is "user cancelled the picker"; a `Blob` (real `File`) lets
  the plugin read file contents lazily via `blob.text()` /
  `blob.arrayBuffer()`. Mirrored in
  `packages/noteser-plugin-sdk/src/sdk.ts`.
- Wire-protocol additions:
  `worker:requestDirectoryOpen` (`src/plugins/protocol.ts`) and
  `host:directoryOpenResult`. Both registered in `isHostToWorker` /
  `isWorkerToHost` type guards. Constant `MAX_DIRECTORY_ENTRIES` (50,000)
  exported alongside the existing rate-limit constants.
- Host handler in `pluginHostSingleton.ts`:
   - Modern path: `showDirectoryPicker()` → recursive walk via
     `walkDirectoryHandle` (extracted into
     `src/plugins/directoryPickerHelpers.ts` so it can be unit-tested
     without spinning up the singleton).
   - Fallback path: `<input type="file" webkitdirectory>`. Mirrors the
     existing single-file fallback at line ~458 of the singleton but
     sets `webkitdirectory` + `directory` so the picker browses
     folders. `webkitRelativePath` carries the root segment; we strip
     it so the returned `path` is relative to the picked root,
     matching the modern-path output.
   - 50k cap enforced post-walk. The walker returns as soon as
     `out.length > MAX_DIRECTORY_ENTRIES` so we never scan a
     million-file tree.
   - Extension filter applied host-side via `buildExtensionMatcher`.
     Case-insensitive, leading dot optional, e.g. `['md', '.MARKDOWN']`
     all work.
- Manifest-preview modal copy line:
  "Open folders to read files into the plugin. You pick the folder;
  the plugin sees the file names and contents under that folder,
  nothing else." Rendered automatically by
  `PluginInstallConfirmModal.tsx` via the existing
  `PERMISSION_DESCRIPTIONS` lookup.
- Settings → Plugins revocation hook: the per-permission checkbox UI
  + `revokedPermissions` field + `setPermissionRevoked` action already
  landed in PR C. PR E plugs `fs.open-directory` into the same
  pipeline (`PluginHost.handleWorkerMessage` consults
  `entry.plugin.revokedPermissions.has('fs.open-directory')` before
  dispatching the picker). Subsequent capability calls after revocation
  reject with `Permission "fs.open-directory" was revoked.`
- Reference plugin `public/plugins/noteser-folder-demo/` with a single
  command "Folder demo: count files in a folder" that exercises the
  modern + fallback paths end-to-end and toasts the count after
  filtering to `.md` / `.markdown`.

### Deviations from the plan

1. **Wire shape uses `Blob`, not `bytesBase64`.** The plan's section
   5.1 typed `HostDirectoryOpenResult.entries` as
   `Array<{ relativePath, name, bytesBase64, mimeType }>`. We ship
   `Array<{ name, path, blob }>` instead:
   - Structured clone passes `Blob` through `postMessage` natively,
     so we avoid a base64 round-trip for what could be a half-gigabyte
     of file content.
   - The plugin reads lazily via `blob.text()` / `blob.arrayBuffer()`;
     a `for (const e of entries)` that touches only `.md` files no
     longer loads the entire folder into the worker's heap up front.
   - `mimeType` lives on the `Blob` itself
     (`blob.type`), so dropping the field loses nothing.
   The change is forward-compatible: a future PR that ships a streaming
   version (`fs.openDirectoryStream`) can add lazy fetch without
   reworking the existing `entries` shape.

2. **`relativePath` renamed to `path`.** The user-facing prompt asked
   for `{ name, path, blob }`. Both are unambiguous (the picked root is
   always the prefix-base), so the shorter name wins.

3. **No 500 MiB size cap.** Section 4.3 mentions a 500 MiB total-byte
   cap alongside the 50,000-entry cap. Because we now hand back lazy
   `Blob`s we never see the bytes until the plugin reads them, and the
   cap would need to walk every blob to enforce. The 50,000-entry cap
   is the practical proxy: an Obsidian vault hitting it has bigger
   problems than a noteser import limit. A byte cap can land in v1.3
   alongside the streaming variant.

4. **Revocation store action lives in PR C, reused in PR E.** PR C
   shipped `revokedPermissions: PluginPermission[]` on
   `InstalledPluginRecord`, the `setPermissionRevoked` action, the
   singleton helper `setPluginPermissionRevoked`, and the
   `PluginHost.{revokePermission, restorePermission}` runtime methods.
   PR E reuses every piece — the only addition here is the
   `fs.open-directory` check in `PluginHost.handleWorkerMessage`. PRs
   D and F will piggy-back on the same plumbing.

### Test coverage

- `src/__tests__/plugins/fsOpenDirectory.test.ts`:
   - Manifest validator accepts `fs.open-directory`, rejects
     `fs.openDirectory` (typo), mixes with v1.1 permissions.
   - `PluginHost` short-circuits `worker:requestDirectoryOpen` with a
     permission-not-declared error when the manifest is silent;
     emits `directoryOpenRequested` when the permission is present.
   - `respondDirectoryOpen` round-trips `Blob` entries faithfully and
     distinguishes "user cancelled" (`ok: true`, no `entries`) from
     "host failed" (`ok: false`, `error`).
   - `buildExtensionMatcher` covers leading-dot, case-insensitive,
     mid-name false-positive cases.
   - `walkDirectoryHandle` covers flat / nested / cap-overflow trees
     and asserts blobs read back to their original contents.
   - jsdom-driven test for the `<input webkitdirectory>` `cancel`
     event rejection — the path the user prompt called out
     specifically.
- `src/__tests__/plugins/pluginInstallStoreRevocation.test.ts`:
   - PR C's `setPermissionRevoked` action covers the
     `fs.open-directory` arm: toggles, double-toggle round-trips,
     idempotent no-ops, unknown plugin id no-ops.

### Manual verification

- Chrome / Edge / Opera: `showDirectoryPicker()` opens the native
  directory dialog; picking a folder full of `.md` files toasts the
  count.
- Safari / Firefox: `<input webkitdirectory>` opens the folder picker;
  same outcome. Pressing Cancel toasts "Folder pick cancelled." rather
  than throwing.

### Files touched

```
docs/plugins-v1.2-impl-notes.md                                     (appended)
packages/noteser-plugin-sdk/src/index.ts
packages/noteser-plugin-sdk/src/manifest.ts
packages/noteser-plugin-sdk/src/sdk.ts
public/plugins/noteser-folder-demo/main.js                          (new)
public/plugins/noteser-folder-demo/manifest.json                    (new)
src/__tests__/plugins/fsOpenDirectory.test.ts                       (new)
src/__tests__/plugins/pluginInstallStoreRevocation.test.ts          (new)
src/components/modals/PluginsSettingsPanel.tsx
src/plugins/PluginHost.ts
src/plugins/directoryPickerHelpers.ts                               (new)
src/plugins/manifest.ts
src/plugins/pluginHostSingleton.ts
src/plugins/protocol.ts
src/plugins/sdk.ts
src/plugins/workerEntry.ts
src/stores/pluginInstallStore.ts
```

## PR B — fullscreen view surface

Lands the `surfaces.fullscreenViews` manifest field, the host modal at
`src/components/plugins/PluginFullscreenView.tsx`, the wire envelopes
for open / close / setContent, and the `ctx.openFullscreen` /
`ctx.closeFullscreen` / `ctx.setFullscreenContent` SDK methods. Follows
plan section 3.1 with the deviations and choices below.

### Single-view invariant — reject, do not replace

The plan permits either rejecting a second `openFullscreen` call or
replacing the active view. PR B picks REJECT, with the exact error
string `'Another fullscreen view is already open.'` per plan section
3.1. Reasoning: replacing would silently destroy the original view's
worker state (any in-flight async setup the first plugin had queued)
and surprise the user mid-flow. A clear error lets the calling plugin
fall back to a sidebar panel or toast, and lets a user-facing UI later
prompt "close the other view first" without ambiguity.

The two coordination layers are deliberately split: `PluginHost`
checks the view id against the calling plugin's manifest (fast,
local), and `pluginHostSingleton.handleFullscreenOpenRequest` checks
the cross-plugin single-view invariant. The split means a manifest
typo and a "second plugin tried to open one" produce different
error messages, so the calling plugin can disambiguate.

### Note focus loss — modal persists across note changes

Per plan section 3.1's open question: opening a fullscreen view does
NOT suspend the editor and does NOT auto-close when the active note
changes. The plugin stays in control. The store-backed view persists
until:

1. The user clicks the X-close button.
2. The user presses Esc (capture phase so a plugin handler cannot
   trap it).
3. The plugin calls `ctx.closeFullscreen(viewId)` explicitly.
4. The browser fires `pagehide` (route change, tab close). The host
   listens and dismisses so `onFullscreenUnmount` runs before the
   plugin's worker is terminated.
5. The plugin is uninstalled. `pluginStore.remove` drops
   `activeFullscreen` when the removed plugin owns it.

Reasoning: the gated v1.2 features (graph view #71, AI chat #70,
importer review #73) all keep state that survives note switches.
Auto-closing on `onActiveNoteChange` would force every plugin to
re-implement "rehydrate from scratch" — at which point we have
re-imposed sidebar-panel semantics on a surface that exists precisely
to escape them. The plugin still receives `onActiveNoteChange` while
the modal is open (the plan calls this out explicitly) and can call
`closeFullscreen` itself if a particular view does want to dismiss.

### Lifecycle envelopes — split open response from mount notification

The plan shows `host:mountFullscreen` as the host → worker message
fired after the modal mounts. PR B splits this into TWO envelopes:

- `host:fullscreenOpenResult` — paired with `worker:openFullscreen`'s
  `requestSeq`, resolves the plugin's `openFullscreen()` Promise.
- `host:fullscreenOpened` — fire-and-forget, runs the plugin's
  `onFullscreenMount` handler.

The split lets the plugin's `await ctx.openFullscreen(...)` resolve
BEFORE the mount handler starts emitting content updates; without it,
a plugin that writes `await ctx.openFullscreen(); ctx.setFullscreenContent(...)`
risks racing the mount-handler's own `setFullscreenContent` and double-
rendering. Symmetrically, `host:fullscreenClosed` runs the plugin's
`onFullscreenUnmount`. The wire-protocol names in the plan stay valid
as a higher-level concept; the actual envelopes are these two.

### Z-index, scroll lock, focus trap

The modal renders at `z-index: 9999` via an inline style (Tailwind's
preset z-50 sits at 50, the existing `Modal.tsx` uses z-50 for the
install confirm dialog; the plan says "above sidebars and toasts" so
9999 buys headroom above any future overlay). Body scroll lock and
focus trap reuse the same inline-trap pattern as `Modal.tsx` (the
trap from PR #104). The trap is duplicated rather than extracted to
a shared hook because:

- The two trap callsites have different lifecycle triggers (Modal is
  store-driven via `isOpen`; PluginFullscreenView is store-driven via
  `activeFullscreen !== null`).
- Extracting now would force a hooks API decision that should land
  with a third trap site, not at N=2.

### Store ownership of `activeFullscreen`

The active view lives in `pluginStore.activeFullscreen` alongside the
loaded-plugin map rather than in `uiStore`. Reasoning: lifecycle is
plugin-owned, not user-owned. When `pluginStore.remove` runs, the
slot drops automatically, so a buggy plugin teardown cannot leave a
zombie modal pointing at a torn-down worker.

### Reference plugin

Extended `public/plugins/noteser-vnode-demo` (v0.2.0) instead of
adding a separate plugin: one install slot, one set of permissions to
review, one place to maintain the v1.2 demo surface. The plugin now
declares `surfaces.commands` and `surfaces.fullscreenViews`; the
`onCommand` handler awaits `openFullscreen('demo-view')`, the
`onFullscreenMount` handler populates a box with a callout, button,
and SVG, and `onFullscreenUnmount` fires a notify toast so a human
can confirm the close lifecycle round-trips end-to-end.

### Manifest-preview modal

`SURFACE_DESCRIPTIONS.fullscreenViews` reads:
"Opens a full-window view when the plugin asks. You can close it any
time with Esc or the X button." The capability row in the install
modal renders as `Provides full-screen view(s)` with the prose below,
matching the existing prose pattern from PR #104's a11y pass.

### Test coverage

`src/plugins/__tests__/PluginFullscreenView.test.tsx` covers mount/
unmount, X-close, Esc-close, focus trap (Tab and Shift+Tab wrap),
body scroll lock, content updates, the store's single-view
invariant, and the singleton's `dismissActiveFullscreen` helper.
`src/__tests__/plugins/manifest.test.ts` gains a `surfaces.fullscreenViews`
block covering the happy path plus rejection of non-arrays, bad ids,
empty / oversize titles, and duplicate ids. `src/__tests__/plugins/PluginHost.test.ts`
gains a "fullscreen wire (PR B)" describe block covering the
manifest-validated open path, the rejected open for an undeclared
view, and the `worker:closeFullscreen` / `worker:setFullscreenContent`
fan-out to PluginHostEvent listeners.

### Out-of-scope reminders for downstream PRs

- The `ctx.onVNodeEvent` registration API still has not landed; the
  fullscreen modal's `handleEvent` is a no-op pending that PR, same
  as the panel surface. When it does land, this file's
  `PluginFullscreenView.tsx` needs the dispatcher hooked through
  `host:vnodeEvent` with `source: { kind: 'fullscreen', viewId }`.
- PR D MUST NOT touch the fullscreen surface; the remaining
  capability PR is surface-agnostic by design.

## PR D — `vault.write` capability + audit trail

Implements plan sections 4.2, 5, 6, 7, and 8 as they pertain to
`vault.write`. Branch `feat/plugins-v1.2-D-vault-write`.

### Permission

`vault.write` joins `file-save` and `file-open` in
`src/plugins/manifest.ts`'s `PERMISSIONS` tuple. It is the first
member of a new `DESTRUCTIVE_PERMISSIONS` set — the install-confirm
modal renders destructive permissions inside a red-bordered section
with a red bullet, and demands an explicit opt-in checkbox per
destructive entry before the Install button enables. Informational
permissions (`file-save`, `file-open`) keep the amber CheckCircle
styling that landed in v1.1.

### SDK surface

`ctx.vault.write` exposes four async methods:

- `createNote({ title, body, folderPath?, frontmatter? })`
  → `Promise<{ id, conflictResolved }>`
- `updateNote(id, { title?, body?, frontmatter? })` → `Promise<void>`
- `deleteNote(id)` → `Promise<void>` (soft-delete only; landing in the
  Trash is intentional so the user can recover from a plugin bug)
- `createFolder(path)` → `Promise<void>` (idempotent, ensures all
  intermediate segments)

Both `src/plugins/sdk.ts` and `packages/noteser-plugin-sdk/src/sdk.ts`
gained the namespace. The runtime `definePlugin` is unchanged;
manifest validation stays host-side.

### Wire protocol

Two new envelopes in `src/plugins/protocol.ts`:

- `WorkerRequestVaultWrite` carries a discriminated `op` union over the
  four operations.
- `HostVaultWriteResult` carries `ok`, `requestSeq`, optional `id` +
  `conflictResolved` for successful `create`s, and `error` on failure.

`isHostToWorker` / `isWorkerToHost` accept the new types; the
`MAX_ENVELOPE_BYTES` and rate-limit guards apply unchanged.

### Host implementation

`pluginHostSingleton.ts` adds `handleVaultWriteRequest` which writes
through the EXACT SAME `useNoteStore.addNote` / `updateNote` /
`deleteNote` and `useFolderStore.ensureFolderPath` paths a user action
takes. Sync, indexing, and undo behave identically whether the user or
a plugin made the change.

`folderPath` is resolved via `ensureFolderPath` — the same helper the
pull layer uses to materialise repo paths. A plugin asking for
`"Imported/Obsidian"` and the user manually creating that folder
converge on the same folder ids.

### Conflict resolution

`createNote` runs through `resolveTitleConflict` before delegating to
the store:

1. No active (non-trashed) note in the same folder shares the
   requested title (case-insensitive) → use it verbatim.
   `conflictResolved: 'none'`.
2. Otherwise, try `"<title> (imported)"`. `conflictResolved: 'suffix'`.
3. Chained collisions roll forward: `(imported 2)`, `(imported 3)`, …
   Still `conflictResolved: 'suffix'`.

The host surfaces the renamed title via the `conflictResolved` flag.
The importer plugin (issue #73) plumbs it into its progress log
straight from the existing return value.

### Validation

Per plan §4.2: title 1–200 chars, body ≤ 1 MiB,
`folderPath` matches `/^[^\s/][^/]*(\/[^\s/][^/]*)*$/`. Hard-delete is
intentionally absent — plugins cannot bypass the Trash UI.

### Revocation

PR D reuses PR C's revocation plumbing rather than introducing a new
mechanism:

- `revokedPermissions: PluginPermission[]` on `InstalledPluginRecord`,
  plus the `setPermissionRevoked` / `isPermissionRevoked` store
  helpers, all from PR C.
- `PluginHost.revokePermission(pluginId, perm)` /
  `restorePermission` / `hasPermission` — also from PR C.
- The vault.write message handler runs the same two-layer gate PR C
  established for vault.read.all: declared in manifest AND not in
  `entry.plugin.revokedPermissions`. Distinct error strings so the
  dev console clarifies; the plugin sees the same Promise rejection
  either way.
- file-save / file-open paths now also honour the revocation Set
  (previously only the declared-permissions list). One-line
  symmetry fix riding in this PR.

The red "Destructive" badge in Settings → Plugins persists as long
as the destructive permission stays declared in the manifest — even
after revocation — so the user always sees at a glance which plugins
were granted dangerous capabilities historically. The per-permission
toggle row still uses PR C's `setPluginPermissionRevoked` exported
from the singleton.

### Audit trail

`src/utils/pluginAudit.ts` is new. Every accepted vault.write op (and
every host-side rejection that survives the permission gate) records
an entry: `pluginId`, `op`, `target`, `ok`, optional `error` and
`conflictResolved`, plus `ts`. Storage is a 500-entry ring buffer in
memory, flushed to `localStorage` with a 250 ms debounce — chosen over
the Zustand + IndexedDB path so the log keeps working when the noteser
stores are mid-migration. A read-only "Plugin activity" panel in
Settings → Plugins renders the last 50 entries.

Example entry shape (newline-separated for readability — the on-disk
JSON is one object per push):

    {
      "ts": 1717718400000,
      "pluginId": "noteser-write-demo",
      "op": "create",
      "target": "8e7a51d3-...",
      "ok": true,
      "conflictResolved": "none"
    }

### Reference plugin

`public/plugins/noteser-write-demo/` ships a single command "Plugin
demo note" that calls `ctx.vault.write.createNote`. Running it twice
exercises the title-collision resolver and demonstrates the suffix.

### Tests

`src/__tests__/plugins/vaultWrite.test.ts` covers:

- Manifest validator accepts `vault.write` and rejects malformed
  values; `isDestructivePermission` flags it.
- `PluginHost` refuses `worker:requestVaultWrite` when the permission
  was not declared and when it was revoked.
- Each of the four ops round-trips through the wire protocol:
  create returns `{ id, conflictResolved }`; update / delete /
  createFolder resolve void.
- `resolveTitleConflict` suffixes correctly on collision (single
  + chained).
- Audit log appends one entry per accepted op AND one per failed op.

`src/__tests__/plugins/pluginAudit.test.ts` covers the ring buffer in
isolation: ordering, MAX_ENTRIES rollover, per-plugin filtering, and
the localStorage flush.

### Out of scope (deferred)

- Bulk `importNotes(records[])` envelope — plan §4.2 keeps this for
  v1.3. The 60 messages/sec rate limit means a 5 k-note Obsidian
  import takes ~83 s; acceptable.
- Per-plugin "Recent activity" drill-down view — `readPluginAuditFor`
  exists for it but the UI is the global list for now.
