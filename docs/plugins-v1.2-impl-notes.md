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
