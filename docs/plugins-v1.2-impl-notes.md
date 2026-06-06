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
