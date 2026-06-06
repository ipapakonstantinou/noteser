# Plugin API v1.2 design plan

Status: DRAFT 2026-06-06. Branch `docs/plugin-api-v1.2-plan`. Successor
to `docs/plugins-plan.md` (v1, LOCKED 2026-06-02) and the v1.1
`file-save` / `file-open` increment shipped on top of it.

## 1. Motivation

Two deferred features hit the v1.1 plugin ceiling at the same time.
Issue #112 (graph view + backlinks, gap on issue #71) reports:
"VNode set is too narrow [...] No `list`, `button`, `link`, `svg`, or
`canvas` primitive. Even a clickable backlink list is not expressible,
let alone a force-directed graph." Issue #113 (importer, gap on issue
#73) reports: "`requestFileOpen` is single-file only [...] There is no
`createNote(args)` / `writeNote(path, content)` / bulk
`importNotes(records[])`. An importer that cannot create notes is not
an importer." Two more priority features (#70 AI chat / RAG, #72
properties / tables) are shaped the same way and are expected to fail
the same gate. The goal of v1.2 is one coordinated lift that unlocks
all four as plugins under the existing Worker isolation and
capability-mediated security model, rather than shipping any of them
in core "temporarily". This document is authoritative for the next
round of implementation PRs.

## 2. VNode set extension

v1 ships two VNode tags (`text`, `callout`) at
`src/plugins/PluginVNode.tsx:35`. v1.2 adds seven more shapes. Every
shape stays JSON-serialisable through `postMessage`; no function
references, no DOM nodes, no React elements escape the worker.

### 2.1 Shared event-handler shape

Functions do not survive `postMessage`. Event handlers are declared
as plain records, dispatched back through the wire protocol, and
matched in the worker against names the plugin registered via
`ctx.onVNodeEvent`.

```ts
type VNodeEvent = {
  kind: 'emit'
  /** Plugin-defined event name. Host treats as opaque. */
  event: string
  /** Optional payload echoed back on `worker:vnodeEvent`. */
  payload?: unknown
}
```

The host wires only `onClick`, `onChange`, `onSubmit`, and `onKeyDown`
(Esc / Enter only). Any other property the plugin writes onto a
VNode is ignored. For inputs the host augments the emitted payload
with `{ value }`.

### 2.2 New VNode shapes

```ts
interface VNodeButton {
  tag: 'button'
  label: string
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  onClick?: VNodeEvent
}

interface VNodeInput {
  tag: 'input'
  type: 'text' | 'number' | 'search' | 'select'
  options?: ReadonlyArray<{ value: string; label: string }> // for select
  value?: string | number
  placeholder?: string
  disabled?: boolean
  onChange?: VNodeEvent
}

interface VNodeList {
  tag: 'list'
  ordered?: boolean
  items: ReadonlyArray<VNode> // depth-capped at 8
}

interface VNodeLink {
  tag: 'link'
  label: string
  href:
    | { kind: 'note'; noteId: string }
    | { kind: 'anchor'; fragment: string }
}

interface VNodeRadio {
  tag: 'radio'
  group: string
  options: ReadonlyArray<{ value: string; label: string }>
  value?: string
  onChange?: VNodeEvent
}

interface VNodeSvg {
  tag: 'svg'
  width: number
  height: number
  viewBox?: readonly [number, number, number, number]
  children: ReadonlyArray<SvgChild>
}

type SvgChild =
  | { tag: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth?: number }
  | { tag: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; onClick?: VNodeEvent }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; onClick?: VNodeEvent }
  | { tag: 'text'; x: number; y: number; value: string; fontSize?: number; fill?: string }
  | { tag: 'path'; d: string; stroke?: string; fill?: string; strokeWidth?: number }

interface VNodeBox {
  tag: 'box'
  children: ReadonlyArray<VNode>
  gap?: 0 | 1 | 2 | 3 | 4
}

type VNode =
  | VNodeText | VNodeCallout                                       // v1
  | VNodeButton | VNodeInput | VNodeList | VNodeLink
  | VNodeRadio | VNodeSvg | VNodeBox                               // v1.2
```

### 2.3 Renderer surface

All new tags land as additional `if (tag === ...)` branches in
`renderPluginVNode` (`src/plugins/PluginVNode.tsx:70`). The switch
returns `ReactNode | null`; fallback through `PluginNode` is a JSON
dump. The SVG branch returns a real `<svg>` element with a string
`viewBox` built from the tuple; its children map to `<line>`,
`<circle>`, etc. The renderer never uses `dangerouslySetInnerHTML`
and never templates an attribute from a plugin-supplied string.

### 2.4 Security caveats

- Strings render as text content. React's default escaping handles
  XSS on `text`, `label`, `placeholder`, `value`, and SVG
  `text.value`.
- Numeric props (`x`, `y`, `width`, `r`, etc.) are coerced via
  `Number()` and rejected if `!Number.isFinite(n)`. Stops a plugin
  from leaking a string into a future numeric attribute.
- `VNodeLink.href` is a discriminated union of `note` / `anchor`.
  The renderer constructs the real URL host-side. The plugin never
  produces a raw `href` string, so `javascript:`, `data:`, `mailto:`,
  and external URLs are structurally impossible.
- `variant`, `kind`, and similar enum-typed props fall back to a
  default when unrecognised, matching the existing `callout.kind`
  pattern (`PluginVNode.tsx:85`).
- List recursion is capped at depth 8. Deeper trees render the JSON
  fallback. Stops a plugin from blowing the React stack.
- `svg.path.d` is passed through directly. SVG path syntax is
  non-executable in browsers, but the renderer rejects strings
  longer than 8 KB to bound parse cost.
- Color strings (`fill`, `stroke`) match
  `/^(#[0-9a-f]{3,8}|rgb\(.*\)|rgba\(.*\)|[a-z]+)$/i` with a 32-char
  cap. Unknown values fall back to `currentColor`.
- Disabled buttons and inputs do not register event listeners
  host-side, so a plugin cannot fire events for a disabled control.

### 2.5 Explicit non-goals

- NO `script` tag, NO `<style>`, NO `<iframe>`, NO `<object>`, NO
  `<embed>`. The worker has no DOM and no eval path; no VNode shape
  can surface them.
- NO raw HTML injection. There is no `tag: 'html'` and the renderer
  never reaches `dangerouslySetInnerHTML`.
- NO `<canvas>`. Force-directed graph rendering uses SVG, which
  composes with React's reconciler. Canvas needs its own drawing
  protocol and review; deferred to v1.3 if SVG proves insufficient
  at vault scale.
- NO event names beyond the curated four
  (`onClick` / `onChange` / `onSubmit` / `onKeyDown`).
- NO file input as a VNode. File picking goes through the `fs`
  capability, which the user triggers and the host renders.

### 2.6 Worked examples

Backlinks list (issue #71):

```ts
ctx.setPanelContent('backlinks', {
  tag: 'list',
  ordered: false,
  items: backlinks.map(b => ({
    tag: 'link',
    label: b.title,
    href: { kind: 'note', noteId: b.id },
  })),
})
```

Format picker (issue #73):

```ts
ctx.setPanelContent('importer', {
  tag: 'box', gap: 2,
  children: [
    { tag: 'text', value: 'Pick a source format:' },
    {
      tag: 'radio', group: 'format', value: selected,
      options: [
        { value: 'obsidian', label: 'Obsidian vault folder' },
        { value: 'notion', label: 'Notion ZIP export' },
        { value: 'logseq', label: 'Logseq export folder' },
      ],
      onChange: { kind: 'emit', event: 'pickFormat' },
    },
    { tag: 'button', label: 'Choose source', variant: 'primary',
      onClick: { kind: 'emit', event: 'chooseSource' } },
  ],
})
```

SVG node-edge diagram (issue #71):

```ts
ctx.setFullscreenContent('graph', {
  tag: 'svg', width: 1024, height: 768, viewBox: [0, 0, 1024, 768],
  children: [
    ...edges.map(e => ({
      tag: 'line' as const,
      x1: e.from.x, y1: e.from.y, x2: e.to.x, y2: e.to.y,
      stroke: '#666', strokeWidth: 1,
    })),
    ...nodes.map(n => ({
      tag: 'circle' as const,
      cx: n.x, cy: n.y, r: 6, fill: '#4f8',
      onClick: { kind: 'emit', event: 'pickNode', payload: { id: n.id } },
    })),
  ],
})
```

## 3. New plugin surfaces

### 3.1 `fullscreenView`

Motivation: graph view (#71), AI chat (#70), and importer review
panes (#73) need a render area larger than a sidebar.

Manifest declaration:

```ts
surfaces: {
  fullscreenViews: [
    { id: 'graph', title: 'Note graph' },
  ],
}
```

API surface:

```ts
openFullscreen(viewId: string): Promise<void>
closeFullscreen(viewId: string): void
setFullscreenContent(viewId: string, node: VNode): void

// new handlers
onFullscreenMount?: (viewId: string, ctx: PluginCtx) => void | Promise<void>
onFullscreenUnmount?: (viewId: string, ctx: PluginCtx) => void | Promise<void>
```

Lifecycle:

1. Plugin (or a user command, via a palette entry the plugin
   registers) calls `ctx.openFullscreen(viewId)`.
2. Host checks: view id was declared in the manifest; no other
   fullscreen view is open. Conflict rejects with
   `Error('Another fullscreen view is already open.')`.
3. Host mounts a modal at z-index above sidebars and toasts. The
   chrome shows plugin name, view title, and an X button.
4. Host posts `host:mountFullscreen`; worker fires
   `onFullscreenMount`.
5. Host wires Esc on `document` (capture phase) to close.
6. On close (X, Esc, or `ctx.closeFullscreen`) the host posts
   `host:unmountFullscreen`; worker fires `onFullscreenUnmount`.

Note focus loss: opening a fullscreen view does NOT suspend the
underlying editor. The active note stays active; if the user
switches notes while the modal is open the plugin still receives
`onActiveNoteChange`. The plugin decides whether to auto-close.
Only one fullscreen view is open at a time, system-wide.

Security caveats:

- The fullscreen view does not bypass the curated VNode set.
- Esc uses `capture: true` so it fires before any nested handler. A
  plugin cannot trap Esc.
- Rate limits (`protocol.ts:23`, 60 messages per second per plugin)
  apply to fullscreen content updates the same as panel updates.

### 3.2 `statusbarItem` (deferred)

Decision: deferred to v1.3. The render surface (one row across the
bottom, host owns layout) is non-trivial: ordering, overflow,
mobile-vs-desktop placement. Out of scope for v1.2.

## 4. New capabilities

Each capability gets a permission string in the manifest. The
existing v1.1 validator (`src/plugins/manifest.ts:275`) rejects
unknown values; the new strings extend `PERMISSIONS` and
`PERMISSION_DESCRIPTIONS`. Every capability is revocable from
Settings → Plugins; revocation rejects subsequent calls with
`'Permission was revoked.'`.

### 4.1 `vault.read.all`

Motivation: backlinks (#71), AI RAG context (#70), and properties
aggregation (#72) all need bodies of notes the user is not currently
viewing.

API surface:

```ts
interface NoteWithBody {
  id: string
  title: string
  folderPath: string
  body: string
  frontmatter: Readonly<Record<string, unknown>> | null
  updatedAt: number
}

ctx.vault.read.getAllNotes(): Promise<ReadonlyArray<NoteWithBody>>
ctx.vault.read.getNote(id: string): Promise<NoteWithBody | null>
ctx.vault.read.stream(opts?: { chunkSize?: number }):
  AsyncIterable<ReadonlyArray<NoteWithBody>>
```

Security caveats:

- Manifest declares `vault.read.all`. Modal copy: "Read the full
  content of every note in your vault. Required for features like
  backlinks, graph views, and AI search."
- Host snapshots bodies at call time from `useNoteStore`; deleted
  notes are filtered out.
- `frontmatter` is the host's parsed view; the worker never sees raw
  YAML, so it cannot probe for parser bugs in noteser core via the
  plugin.
- `getAllNotes` rejects with `'Vault too large; use stream().'` when
  the projected serialised size exceeds 4 MiB. Stream chunks stay
  under `MAX_ENVELOPE_BYTES` (`protocol.ts:20`, 256 KB) by capping
  `chunkSize` at 500 notes.

### 4.2 `vault.write`

Motivation: importer (#73), AI summary writes (#70), properties UI
saves (#72).

API surface:

```ts
ctx.vault.write.createNote(args: {
  title: string
  body: string
  folderPath?: string
  frontmatter?: Record<string, unknown>
}): Promise<{ id: string; conflictResolved: 'none' | 'suffix' }>

ctx.vault.write.updateNote(id: string, patch: {
  body?: string
  frontmatter?: Record<string, unknown>
  title?: string
}): Promise<void>

ctx.vault.write.deleteNote(id: string): Promise<void>     // soft-delete only
ctx.vault.write.createFolder(path: string): Promise<void>
```

Security caveats:

- Permission string `vault.write`. Modal copy: "Create, update, and
  move-to-trash notes in your vault. Required for importers, AI
  summary saves, and bulk-edit features."
- Conflict resolution: when a note already exists at the target
  path, the host appends ` (imported)` to the title and returns
  `conflictResolved: 'suffix'`. Lifts the conflict logic out of the
  plugin and into one tested chokepoint.
- Per-call host validation: `title` 1-200 chars, `body` capped at
  1 MiB, `folderPath` matches the existing folder-path regex.
- Hard-delete is intentionally absent. Recovery from a plugin bug
  must be possible through the existing trash UI.
- v1.2 has no bulk envelope. Plugins loop on `createNote`; the
  60-per-second rate limit means a 5,000-note Obsidian import takes
  ~83 seconds. Acceptable for v1.2. A `bulk.importNotes` envelope
  may land in v1.3.

### 4.3 `fs.openDirectory`

Motivation: Obsidian and Logseq importers (#73) need a folder of
files. The current `requestFileOpen` is single-file
(`src/plugins/pluginHostSingleton.ts:430`); the `<input type=file>`
fallback at `pluginHostSingleton.ts:458` does not set
`webkitdirectory`.

API surface:

```ts
interface DirectoryEntry {
  relativePath: string   // forward-slash, relative to picked root
  name: string
  bytes: Uint8Array
  mimeType: string       // '' when unknown
}

ctx.fs.openDirectory(args?: { extensions?: string[] }):
  Promise<ReadonlyArray<DirectoryEntry> | null>
```

Security caveats:

- Permission string `fs.open-directory`. Modal copy: "Read a folder
  you pick. The plugin sees the file names and contents of every
  file under the folder you choose, nothing else."
- Implementation: prefer `showDirectoryPicker` plus recursive
  `FileSystemDirectoryHandle.values()`. Fallback: `<input
  type="file" webkitdirectory>`. Firefox and Safari take the
  fallback path; Chromium takes the native picker.
- The host caps the returned list at 50,000 entries and 500 MiB
  total. Beyond either cap the call rejects with `'Directory too
  large; please pick a smaller folder.'`. Prevents an accidental
  whole-disk pick.
- The host's recursive walker maintains a visited-set keyed by
  resolved handle identity; symlink loops do not recurse.

### 4.4 `vault.events`

Motivation: graph and backlinks plugins need to re-derive on save
(gap #112 point 4). AI RAG plugins need to invalidate caches.

API surface:

```ts
ctx.vault.events.onVaultChange(cb: () => void): () => void
ctx.vault.events.onNoteSaved(cb: (noteId: string) => void): () => void
ctx.vault.events.onActiveNoteChange(cb: (noteId: string | null) => void): () => void
```

Security caveats:

- Permission string `vault.events`. Modal copy: "Be told when notes
  are saved or changed. The plugin learns that a note changed (with
  its id), but reading the body still requires the vault.read.all
  permission."
- All three callbacks are debounced host-side at 250 ms. Plugins
  cannot lower the window. Stops a plugin from forcing a re-derive
  on every keystroke.
- Subscription cap: 16 active callbacks per plugin per event type.
  Beyond that, `subscribe` throws synchronously.
- Subscription cleanup: every plugin unload unwinds its
  subscriptions. The host tracks active subscriptions keyed by
  plugin id.

## 5. Wire protocol additions

`src/plugins/protocol.ts` grows the union types below. Every new
envelope carries `type` and `seq`. Request / response pairs use
`requestSeq`, matching the v1.1 `worker:requestFileSave` pattern
(`protocol.ts:208`).

### 5.1 Host to Worker

```ts
interface HostMountFullscreen   { type: 'host:mountFullscreen'; seq: number; viewId: string }
interface HostUnmountFullscreen { type: 'host:unmountFullscreen'; seq: number; viewId: string }

interface HostVNodeEvent {
  type: 'host:vnodeEvent'
  seq: number
  event: string
  payload: unknown
  source:
    | { kind: 'panel'; panelId: string }
    | { kind: 'fullscreen'; viewId: string }
    | { kind: 'codeBlock'; blockId: string }
}

interface HostVaultReadResult {
  type: 'host:vaultReadResult'
  seq: number
  requestSeq: number
  ok: boolean
  notes?: ReadonlyArray<NoteWithBodyWire>   // for getAllNotes
  note?: NoteWithBodyWire | null            // for getNote
  error?: string
}

interface HostVaultStreamChunk {
  type: 'host:vaultStreamChunk'
  seq: number
  requestSeq: number
  chunkIndex: number                         // 1-indexed; 0 == complete
  notes: ReadonlyArray<NoteWithBodyWire>     // [] signals end-of-stream
  error?: string
}

interface HostVaultWriteResult {
  type: 'host:vaultWriteResult'
  seq: number
  requestSeq: number
  ok: boolean
  id?: string                                // on createNote success
  conflictResolved?: 'none' | 'suffix'
  error?: string
}

interface HostDirectoryOpenResult {
  type: 'host:directoryOpenResult'
  seq: number
  requestSeq: number
  ok: boolean
  entries?: ReadonlyArray<{
    relativePath: string; name: string; bytesBase64: string; mimeType: string
  }>
  error?: string
}

interface HostVaultChangedEvent     { type: 'host:vaultChanged'; seq: number }
interface HostNoteSavedEvent        { type: 'host:noteSaved'; seq: number; noteId: string }
interface HostActiveNoteIdChanged   { type: 'host:activeNoteIdChanged'; seq: number; noteId: string | null }
```

### 5.2 Worker to Host

```ts
interface WorkerSetFullscreenContent { type: 'worker:setFullscreenContent'; seq: number; viewId: string; node: unknown }
interface WorkerOpenFullscreen       { type: 'worker:openFullscreen'; seq: number; viewId: string }
interface WorkerCloseFullscreen      { type: 'worker:closeFullscreen'; seq: number; viewId: string }

interface WorkerRequestVaultRead {
  type: 'worker:requestVaultRead'
  seq: number
  mode: 'all' | 'one' | 'stream'
  noteId?: string                            // required for mode === 'one'
  chunkSize?: number                         // optional for 'stream'; default 200, max 500
}

interface WorkerRequestVaultWrite {
  type: 'worker:requestVaultWrite'
  seq: number
  op:
    | { kind: 'create'; title: string; body: string; folderPath?: string; frontmatter?: Record<string, unknown> }
    | { kind: 'update'; id: string; title?: string; body?: string; frontmatter?: Record<string, unknown> }
    | { kind: 'delete'; id: string }
    | { kind: 'createFolder'; path: string }
}

interface WorkerRequestDirectoryOpen {
  type: 'worker:requestDirectoryOpen'
  seq: number
  extensions?: string[]
}

interface WorkerSubscribeVault {
  type: 'worker:subscribeVault'
  seq: number
  event: 'vaultChanged' | 'noteSaved' | 'activeNoteIdChanged'
  subscriptionId: string
}

interface WorkerUnsubscribeVault {
  type: 'worker:unsubscribeVault'
  seq: number
  subscriptionId: string
}
```

### 5.3 Error cases

- Permission not granted: host responds `ok: false`,
  `error: 'Permission "<name>" was not granted.'`; worker rejects
  the corresponding promise with that message.
- Envelope too large: existing `MAX_ENVELOPE_BYTES` gate
  (`protocol.ts:20`) still applies; stream chunks stay under the
  cap because `chunkSize` is capped at 500.
- Stream mid-flight revocation: host emits a terminal chunk with
  `notes: []` and a non-empty `error`; worker rejects the
  AsyncIterable.
- Boot before vault hydrates: any `vault.read.all` call before the
  note store finishes hydrating rejects with
  `'Vault not yet loaded.'`. Plugin retries via `onVaultChange`.

## 6. SDK additions

`packages/noteser-plugin-sdk/src/sdk.ts` (mirror of
`src/plugins/sdk.ts`) gains the new type exports. The runtime
`definePlugin` function stays a pure pass-through; manifest
validation remains host-side.

```ts
export type {
  VNode, VNodeButton, VNodeInput, VNodeList, VNodeLink,
  VNodeRadio, VNodeSvg, VNodeBox, VNodeEvent,
  NoteWithBody, DirectoryEntry,
} from './vdom'

export interface PluginCtx {
  // v1 baseline (unchanged)
  readonly activeNote: { id: string; title: string; content: string } | null
  readonly notes: ReadonlyArray<{ id: string; title: string; folderPath: string }>
  setPanelContent(panelId: string, node: VNode): void
  renderCodeBlock(blockId: string, node: VNode): void
  insertText(text: string): void
  notify(message: string): void
  getSetting<T = unknown>(key: string): T | undefined
  setSetting<T = unknown>(key: string, value: T): void

  // v1.1 file I/O (unchanged)
  requestFileSave(args: { suggestedName: string; mimeType: string; bytes: Uint8Array }): Promise<void>
  requestFileOpen(args?: { accept?: string[] }): Promise<{ bytes: Uint8Array; filename: string } | null>

  // v1.2 fullscreen surface
  openFullscreen(viewId: string): Promise<void>
  closeFullscreen(viewId: string): void
  setFullscreenContent(viewId: string, node: VNode): void

  // v1.2 VNode event routing
  onVNodeEvent(event: string, cb: (payload: unknown) => void): () => void

  // v1.2 vault capabilities
  vault: {
    read: {
      getAllNotes(): Promise<ReadonlyArray<NoteWithBody>>
      getNote(id: string): Promise<NoteWithBody | null>
      stream(opts?: { chunkSize?: number }): AsyncIterable<ReadonlyArray<NoteWithBody>>
    }
    write: {
      createNote(args: { title: string; body: string; folderPath?: string; frontmatter?: Record<string, unknown> }):
        Promise<{ id: string; conflictResolved: 'none' | 'suffix' }>
      updateNote(id: string, patch: { body?: string; frontmatter?: Record<string, unknown>; title?: string }): Promise<void>
      deleteNote(id: string): Promise<void>
      createFolder(path: string): Promise<void>
    }
    events: {
      onVaultChange(cb: () => void): () => void
      onNoteSaved(cb: (noteId: string) => void): () => void
      onActiveNoteChange(cb: (noteId: string | null) => void): () => void
    }
  }

  // v1.2 fs capability
  fs: {
    openDirectory(args?: { extensions?: string[] }): Promise<ReadonlyArray<DirectoryEntry> | null>
  }
}

export interface PluginHandlers {
  // unchanged from v1.1
  onActivate?: (ctx: PluginCtx) => void | Promise<void>
  onCommand?: (id: string, ctx: PluginCtx) => void | Promise<void>
  onPanelMount?: (panelId: string, ctx: PluginCtx) => void | Promise<void>
  onPanelUnmount?: (panelId: string, ctx: PluginCtx) => void | Promise<void>
  onActiveNoteChange?: (note: { id: string; title: string; content: string } | null, ctx: PluginCtx) => void | Promise<void>
  onRenderCodeBlock?: (args: { language: string; source: string; blockId: string }, ctx: PluginCtx) => void | Promise<void>

  // v1.2 additions
  onFullscreenMount?: (viewId: string, ctx: PluginCtx) => void | Promise<void>
  onFullscreenUnmount?: (viewId: string, ctx: PluginCtx) => void | Promise<void>
}
```

The `ctx.vault` and `ctx.fs` namespaces are always populated. When
the matching permission was not granted, every method on those
namespaces rejects with `'Permission "<name>" was not granted.'`.
Plugins can catch and degrade.

## 7. Manifest schema changes

`src/plugins/manifest.ts:34` (`PERMISSIONS`) grows:

```ts
export const PERMISSIONS = [
  'file-save',          // v1.1
  'file-open',          // v1.1
  'vault.read.all',     // v1.2
  'vault.write',        // v1.2
  'vault.events',       // v1.2
  'fs.open-directory',  // v1.2
] as const
```

`PluginSurfaceKind` (`manifest.ts:47`) grows `'fullscreenViews'`.
`PluginSurfaces` (`manifest.ts:55`) gains:

```ts
fullscreenViews?: PluginFullscreenView[]

export interface PluginFullscreenView {
  id: string
  title: string
  icon?: string
}
```

`validateFullscreenViews` follows the shape of
`validateSidebarPanels` (`manifest.ts:221`). The "at least one
surface" check (`manifest.ts:162`) sums the new
`fullscreenViews?.length` in.

## 8. Manifest-preview modal updates

The v1.1 modal renders one bullet per surface kind via
`SURFACE_DESCRIPTIONS` and one bullet per permission via
`PERMISSION_DESCRIPTIONS` (`manifest.ts:39` and 49). v1.2 adds:

`PERMISSION_DESCRIPTIONS`:

- `vault.read.all`: "Read the full content of every note in your
  vault. Required for backlinks, graph views, and AI search."
- `vault.write`: "Create, update, and move-to-trash notes in your
  vault. Required for importers and bulk-edit features."
- `vault.events`: "Be told when notes are saved or changed. The
  plugin learns that a note changed, but reading the body still
  requires the read permission."
- `fs.open-directory`: "Read a folder you pick. The plugin sees
  every file under the folder you choose, nothing else."

`SURFACE_DESCRIPTIONS`:

- `fullscreenViews`: "Opens a full-window view (modal) when invoked.
  You can close it any time with Esc or the X button."

The modal's "Required permissions" list groups by severity. v1.2
introduces `vault.write` as the first capability flagged as
"DESTRUCTIVE" (red icon, bold heading). The user must check a
confirmation box specifically for that permission before the install
button enables.

## 9. Worker bridge implications

Must round-trip through the worker (the worker hosts the plugin):

- VNode event delivery (`host:vnodeEvent`). Only the worker holds
  the plugin's `onVNodeEvent` callbacks.
- All `vault.write` calls. Plugin emits, host serves.
- `fs.openDirectory`. Plugin emits, host shows the native picker,
  walks the tree, returns bytes.

Host-side only (the worker has no IndexedDB and no DOM):

- `vault.read.all` body assembly. The worker has no `useNoteStore`
  handle. The host snapshots from the Zustand store on the main
  thread, encodes to JSON, and posts back. For stream mode the host
  paginates over the in-memory notes array.
- Fullscreen modal mount, Esc binding, and z-index management. Pure
  DOM work.
- Native file pickers (`showDirectoryPicker`,
  `<input webkitdirectory>` fallback). DOM-only APIs.
- SVG rendering for the graph. d3-force layout runs inside the
  plugin's bundled `main.js` (and therefore inside the Worker,
  which is fine: it is pure math, no DOM). The host translates the
  resulting coordinates into `<svg>` elements via the VNode
  renderer. The worker never produces SVG strings. If the plugin
  finds d3-force too slow inside the Worker, that is a plugin-side
  performance concern; the host stays out of it.

Vault snapshot cost: a 5,000-note vault at 4 KB per note (~20 MB)
exceeds `MAX_ENVELOPE_BYTES` (`protocol.ts:20`, 256 KB) by two
orders of magnitude. Plugins MUST use `stream()` for vault-wide
reads. `getAllNotes()` rejects with `'Vault too large; use
stream().'` when the projected size exceeds 4 MiB.

## 10. Migration and backwards compatibility

- v1 and v1.1 plugins keep working without changes. The renderer
  switch adds new cases; existing cases are untouched.
- v1 / v1.1 plugins that do not declare a v1.2 permission still
  receive the `ctx.vault` and `ctx.fs` namespaces, but every
  capability call on them rejects. Plugins that never touch those
  namespaces see no behaviour change.
- A v1 / v1.1 plugin that DOES declare a v1.2 permission already
  fails manifest validation today (the v1.1 validator rejects
  unknown permissions at `manifest.ts:293`). After v1.2 ships, the
  same plugin succeeds. This is the definition of "v1.2-capable".
- A plugin that mixes v1.1 (`file-open`) and v1.2 (`vault.read.all`)
  permissions is valid. The validator does not enforce a
  `requiredHostVersion` field; that is deferred to v1.3.
- The fullscreen surface is opt-in. Plugins that do not declare
  `surfaces.fullscreenViews` never receive
  `host:mountFullscreen` / `host:unmountFullscreen`.
- A v1.2 plugin run against a stale host: the older validator
  rejects the unknown permission, the worker emits `bootError`, and
  the user sees a clear install error. No silent capability gap.

## 11. Out of scope for v1.2

- Script execution beyond the existing Worker. No `eval`, no
  dynamic-`Function`, no main-thread bridges.
- An end-to-end plugin marketplace UI inside noteser. URL paste and
  vault scan remain the only install paths.
- `<canvas>` VNode. Deferred; SVG covers the four named use cases.
- Network access (`fetch`) from plugins. Still v2+; AI plugins that
  need OpenAI / Anthropic access gate behind a separate
  `network.fetch` permission in a future plan doc.
- Per-domain network whitelist.
- Plugin-to-plugin communication.
- The `statusbarItem` surface (see section 3.2).
- An in-app plugin author IDE. Plugins are still authored externally
  with vite plus the SDK.
- A `bulk.importNotes(records[])` envelope.
- Mobile-specific plugin behaviour. v1.2 inherits v1's
  "plugins are a desktop experience" stance.
- A `requiredHostVersion` manifest field.

## 12. PR plan

Six PRs, all targeting a long-running branch `feat/plugins-v1.2`.

| PR | Title | Scope | Depends on |
|----|-------|-------|------------|
| A | VNode set extension | `button`, `input`, `list`, `link`, `radio`, `svg`, `box` shapes plus sanitization plus event-handler shape plus unit tests in `src/plugins/__tests__/PluginVNode.test.tsx` | none |
| B | Fullscreen view surface | `surfaces.fullscreenViews` manifest field, host modal mount, Esc / X / lifecycle envelopes, `setFullscreenContent` SDK method | A |
| C | `vault.read.all` capability | New permission, `ctx.vault.read.{getAllNotes, getNote, stream}`, host snapshot from `useNoteStore`, stream chunking, modal preview line, Settings revocation toggle | none |
| D | `vault.write` capability | New permission, `ctx.vault.write.{createNote, updateNote, deleteNote, createFolder}`, conflict-suffix resolution, modal preview line, destructive-permission red bullet | none |
| E | `fs.openDirectory` capability | New permission, `ctx.fs.openDirectory`, `showDirectoryPicker` path, `webkitdirectory` fallback (the gap at `pluginHostSingleton.ts:458`), 50k-entry cap | none |
| F | `vault.events` subscriptions | New permission, `ctx.vault.events.{onVaultChange, onNoteSaved, onActiveNoteChange}`, 250 ms debounce, subscription cleanup on unload | none |

Parallelism:

- PR A is the foundation. PR B depends on A because the fullscreen
  surface renders VNodes from the new set.
- PR C, D, E, F are independent of A, B, and each other. They add
  capabilities, not surfaces; they can land in any order.
- Worked sequence: land A, then merge C, D, E, F in parallel, then
  land B last so its tests can assert against the full VNode set.

Each PR ships: code change; updated unit tests under
`src/plugins/__tests__/`; a short reference-plugin update or new
reference plugin under `public/plugins/` exercising the new
capability end-to-end; an entry in `docs/plugins-v1.2-impl-notes.md`
(created in PR A) covering deviations from this design.

## 13. What each gated feature gets, post v1.2

Issue #70 (AI chat / RAG):

- `radio` plus `input` VNodes for the model / prompt picker.
- `vault.read.all` for RAG context.
- `fullscreenView` for the chat panel.
- `vault.write` for "save the assistant's summary as a new note".
- `vault.events` for cache invalidation on save.
- Future (not in v1.2): `network.fetch` once a domain-allowlist
  permission lands.

Issue #71 (graph view plus backlinks):

- `list` of `link` items for the backlinks sidebar panel.
- `vault.read.all` for backlinks and unlinked-mention derivation.
- `vault.events` for debounced re-derive on save.
- `svg` VNodes for the force-directed graph.
- `fullscreenView` for the global graph (`openFullscreen('graph')`
  from a palette command).

Issue #72 (properties / tables):

- `list` plus `input` shapes for the per-property edit row.
- `vault.read.all` for vault-wide property aggregation ("all notes
  with `status: draft`").
- `vault.write` for the property edits themselves.
- `radio` for a "table / gallery" view toggle.

Issue #73 (importer):

- `radio` for the source-format picker (Obsidian / Notion / Logseq).
- `fs.openDirectory` for Obsidian and Logseq folder picks.
- `requestFileOpen` (existing v1.1 capability) for the Notion ZIP.
- `button` to confirm and start the import.
- `vault.write` to create the notes; the host's
  `conflictResolved: 'suffix'` flag carries the `(imported)` suffix
  outcome straight into the importer's progress log.

---

Next step once approved: open `feat/plugins-v1.2` as the long-running
target branch and dispatch PRs A through F per section 12. Each
implementation PR references this document by section number in its
description.
