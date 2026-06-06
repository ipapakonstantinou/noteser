// Wire protocol between PluginHost (main thread) and the per-plugin
// Web Worker. Both sides exchange JSON-serialisable envelopes via
// postMessage; this file is the schema.
//
// The worker NEVER calls anything synchronously on the host. Every
// interaction is an async message. The host queues incoming messages
// from each plugin and processes them in order, with a per-plugin
// rate limit (`MAX_MESSAGES_PER_SECOND`) to keep a runaway plugin from
// pegging the main thread.
//
// All messages carry a `type` discriminator + a `seq` integer. The host
// pairs request/response by `seq` for the calls that expect a reply
// (the `call:*` family). Fire-and-forget messages (the `event:*` and
// `render:*` families) omit replies.

import type { PluginManifest } from './manifest'

/** Max envelope size in bytes. Host rejects anything bigger; protects
 *  against a plugin trying to ship megabytes of HTML to the renderer. */
export const MAX_ENVELOPE_BYTES = 256 * 1024 // 256 KB

/** Per-plugin rate limit. Host drops + warns above this. */
export const MAX_MESSAGES_PER_SECOND = 60

/** Debounce window (ms) the host applies to every `vault.events`
 *  dispatch (vaultChanged / noteSaved / activeNoteIdChanged). Plugins
 *  cannot lower this — the cap is host-side so a runaway plugin cannot
 *  force a re-derive on every keystroke. Section 4.4 of the v1.2 plan. */
export const VAULT_EVENT_DEBOUNCE_MS = 250

/** Per-event-type cap on active subscriptions for a single plugin. The
 *  worker rejects further `onVaultChange` / `onNoteSaved` /
 *  `onActiveNoteChange` calls synchronously beyond this. */
export const MAX_VAULT_SUBSCRIPTIONS_PER_EVENT = 16

// ─── Host → Worker ─────────────────────────────────────────────────────────

export type HostToWorker =
  | HostBootMessage
  | HostInvokeCommand
  | HostMountPanel
  | HostUnmountPanel
  | HostRenderCodeBlock
  | HostActiveNoteChanged
  | HostFileSaveResult
  | HostFileOpenResult
  | HostVNodeEvent
  | HostVaultReadResult
  | HostVaultStreamChunk
  | HostVaultChangedEvent
  | HostNoteSavedEvent
  | HostActiveNoteIdChanged

/** First message the host sends. Worker initialises the plugin module
 *  and replies with WorkerReady on success or WorkerBootError on failure. */
export interface HostBootMessage {
  type: 'host:boot'
  seq: number
  pluginId: string
  /** Source code of the plugin's main module. The worker uses
   *  `new Function` or a Blob URL import to evaluate it; either way the
   *  source MUST be a fully self-contained ES module string. */
  source: string
}

/** Sent when the user invokes one of the plugin's commands from the
 *  palette or a registered shortcut. */
export interface HostInvokeCommand {
  type: 'host:invokeCommand'
  seq: number
  commandId: string
}

/** Sent when the user opens the plugin's sidebar panel. */
export interface HostMountPanel {
  type: 'host:mountPanel'
  seq: number
  panelId: string
}

/** Sent when the panel is closed; lets the plugin tear down listeners. */
export interface HostUnmountPanel {
  type: 'host:unmountPanel'
  seq: number
  panelId: string
}

/** Sent when a markdown render finds a fenced code block in this
 *  plugin's claimed language. The plugin produces the virtual-DOM
 *  rendering via `worker:renderResult`. */
export interface HostRenderCodeBlock {
  type: 'host:renderCodeBlock'
  seq: number
  language: string
  source: string
  /** Stable id for this block on the current note. Same block fires the
   *  same id across re-renders so the plugin can cache. */
  blockId: string
}

/** Sent whenever the user switches between notes. Plugins use this to
 *  re-render any panel that depends on the active note.
 *
 *  `content` is the FULL body of the active note. The v1 capability
 *  model allows plugins to read the active note's body in full but
 *  NOT the bodies of any other note. */
export interface HostActiveNoteChanged {
  type: 'host:activeNoteChanged'
  seq: number
  note: { id: string; title: string; folderPath: string; content: string } | null
}

/** Host's reply to a worker:requestFileSave. `requestSeq` matches the
 *  seq the worker emitted so the plugin Promise resolves to the right
 *  call. v1.1 capability — requires `file-save` permission. */
export interface HostFileSaveResult {
  type: 'host:fileSaveResult'
  seq: number
  requestSeq: number
  ok: boolean
  error?: string
}

/** Host's reply to a worker:requestFileOpen. Carries the file bytes
 *  on success, or `error` when the user cancelled / a permission was
 *  not granted. */
export interface HostFileOpenResult {
  type: 'host:fileOpenResult'
  seq: number
  requestSeq: number
  ok: boolean
  /** Decoded as a base64 string so JSON-serialisation through
   *  postMessage stays simple. Worker decodes back to Uint8Array. */
  bytesBase64?: string
  filename?: string
  error?: string
}

/** v1.2 — VNode event delivery. The renderer dispatches one of these
 *  every time a plugin-rendered control fires (button click, input
 *  change, radio pick, clickable svg shape). The worker matches
 *  `event` against handlers the plugin registered via
 *  `ctx.onVNodeEvent` (registration API ships in a later v1.2 PR;
 *  this envelope is the wire contract every later PR builds on).
 *
 *  `source` tells the worker which surface produced the event so the
 *  plugin can disambiguate when the same `event` name is used in two
 *  surfaces. PR B fills `kind: 'fullscreen'`; this PR (A) only emits
 *  `kind: 'panel'` / `kind: 'codeBlock'`.
 *
 *  Per the v1.2 plan section 2.1, the host curates which event types
 *  are wireable (`onClick`, `onChange`, `onSubmit`, `onKeyDown`). For
 *  inputs and radios the host augments `payload` with `{ value }`
 *  before posting, so the worker reads the user's selection without
 *  guessing the DOM event shape. */
export interface HostVNodeEvent {
  type: 'host:vnodeEvent'
  seq: number
  /** Plugin-defined event name. Host treats as opaque. */
  event: string
  /** Plugin-supplied payload, possibly augmented with `{ value }` for
   *  inputs and radios. */
  payload: unknown
  /** Which rendered surface produced the event. */
  source:
    | { kind: 'panel'; panelId: string }
    | { kind: 'codeBlock'; blockId: string }
    | { kind: 'fullscreen'; viewId: string }
}

/** v1.2 capability: snapshot of one note's body / frontmatter, sent
 *  across the worker bridge as a plain object. The host normalises
 *  Uint8Arrays / Date / Map into plain types before serialising;
 *  `frontmatter` is the host's parsed view (never raw YAML). */
export interface NoteWithBodyWire {
  id: string
  title: string
  folderPath: string
  body: string
  /** Plain JSON object or null. The host parses YAML; the worker never
   *  sees raw YAML, so it cannot probe noteser-core parser bugs through
   *  this surface. */
  frontmatter: Record<string, unknown> | null
  updatedAt: number
}

/** Host's reply to a `worker:requestVaultRead` in mode `'all'` or
 *  `'one'`. v1.2 capability — requires `vault.read.all` permission.
 *  `requestSeq` matches the seq the worker emitted so the plugin's
 *  pending Promise resolves to the right call.
 *
 *  For `mode === 'all'` the host returns `notes`; for `'one'` it
 *  returns a single `note` (or null when the id is unknown / deleted).
 *  Errors land here when the permission was revoked, the vault has
 *  not hydrated yet, or the projected payload exceeds
 *  `MAX_ENVELOPE_BYTES` and the plugin should fall back to
 *  `stream()`. */
export interface HostVaultReadResult {
  type: 'host:vaultReadResult'
  seq: number
  requestSeq: number
  ok: boolean
  notes?: ReadonlyArray<NoteWithBodyWire>
  note?: NoteWithBodyWire | null
  error?: string
}

/** One chunk of a vault-wide stream read. v1.2 capability — requires
 *  `vault.read.all` permission. The host paginates over the in-memory
 *  notes array on the main thread, chunks at `chunkSize` (capped at
 *  500 to stay under `MAX_ENVELOPE_BYTES`), and emits one of these per
 *  page.
 *
 *  Termination: a chunk with `notes: []` signals end-of-stream. A
 *  non-empty `error` on any chunk terminates the iterator with that
 *  error (used on mid-flight permission revocation). `chunkIndex` is
 *  1-indexed and strictly increasing per `requestSeq`. */
export interface HostVaultStreamChunk {
  type: 'host:vaultStreamChunk'
  seq: number
  requestSeq: number
  chunkIndex: number
  notes: ReadonlyArray<NoteWithBodyWire>
  error?: string
}

// ─── Worker → Host ─────────────────────────────────────────────────────────

export type WorkerToHost =
  | WorkerReady
  | WorkerBootError
  | WorkerCommandHandled
  | WorkerSetPanelContent
  | WorkerRenderResult
  | WorkerInsertText
  | WorkerNotify
  | WorkerRequestFileSave
  | WorkerRequestFileOpen
  | WorkerRequestVaultRead
  | WorkerError
  | WorkerSubscribeVault
  | WorkerUnsubscribeVault

/** Sent in reply to host:boot once the plugin module loaded and
 *  `definePlugin` ran. Includes the validated manifest, which the host
 *  cross-checks against the manifest fetched from the plugin URL. */
export interface WorkerReady {
  type: 'worker:ready'
  seq: number
  manifest: PluginManifest
}

/** Sent in reply to host:boot when the plugin failed to load. */
export interface WorkerBootError {
  type: 'worker:bootError'
  seq: number
  message: string
}

/** Sent after the plugin's `onCommand` handler finished (or threw).
 *  Pure acknowledgement; commands do not return data to the host. */
export interface WorkerCommandHandled {
  type: 'worker:commandHandled'
  seq: number
  commandId: string
  error?: string
}

/** Plugin updating its panel content. The `node` is a curated virtual
 *  DOM the host maps to React. See `vdom.ts` (week 2) for the schema. */
export interface WorkerSetPanelContent {
  type: 'worker:setPanelContent'
  seq: number
  panelId: string
  // For week 1 the node is just a string; week 2 swaps in the VNode union.
  node: unknown
}

/** Plugin replying to a host:renderCodeBlock request with the rendered
 *  virtual DOM. Same VNode placeholder as setPanelContent for now. */
export interface WorkerRenderResult {
  type: 'worker:renderResult'
  seq: number
  blockId: string
  node: unknown
}

/** Plugin asking the host to insert text into the active editor at the
 *  cursor. Trivial command-handler outcome. */
export interface WorkerInsertText {
  type: 'worker:insertText'
  seq: number
  text: string
}

/** Plugin asking the host to show a transient toast message. */
export interface WorkerNotify {
  type: 'worker:notify'
  seq: number
  message: string
}

/** Plugin reporting an unrecoverable error. Host logs + may surface
 *  the message in Settings → Plugins. */
export interface WorkerError {
  type: 'worker:error'
  seq: number
  message: string
}

/** Plugin asking the host to open the native save dialog and write
 *  bytes to a user-picked file. v1.1 capability — requires `file-save`
 *  permission in the manifest, granted by the user at install time.
 *  Host replies with `host:fileSaveResult` carrying the same seq via
 *  `requestSeq`. */
export interface WorkerRequestFileSave {
  type: 'worker:requestFileSave'
  seq: number
  suggestedName: string
  mimeType: string
  /** File bytes encoded as base64. Host decodes, writes via the File
   *  System Access API (or a `<a download>` fallback). */
  bytesBase64: string
}

/** Plugin asking the host to open the native file picker and return
 *  the bytes of the chosen file. v1.1 capability — requires
 *  `file-open` permission. */
export interface WorkerRequestFileOpen {
  type: 'worker:requestFileOpen'
  seq: number
  /** Accepted MIME types or extensions, e.g. ['.pdf', 'application/pdf'].
   *  Empty / undefined means any file. */
  accept?: string[]
}

/** Plugin asking the host for vault-wide note reads. v1.2 capability —
 *  requires `vault.read.all` permission.
 *
 *  Three modes:
 *  - `'all'`     — return every non-deleted note in one response. Host
 *                  rejects with `'Vault too large; use stream().'` when
 *                  projected serialised size exceeds 4 MiB.
 *  - `'one'`     — return a single note by id (or null when unknown /
 *                  deleted). `noteId` is required.
 *  - `'stream'`  — paginate over the vault in chunks. The host emits
 *                  one `host:vaultStreamChunk` per page; the worker
 *                  yields each chunk to the plugin's AsyncIterable.
 *                  Default `chunkSize` is 100; max 500 (the spec
 *                  ceiling, to stay under `MAX_ENVELOPE_BYTES`).
 *
 *  Host replies with `host:vaultReadResult` (modes `'all'` / `'one'`)
 *  or a sequence of `host:vaultStreamChunk` carrying the same
 *  `requestSeq`. */
export interface WorkerRequestVaultRead {
  type: 'worker:requestVaultRead'
  seq: number
  mode: 'all' | 'one' | 'stream'
  /** Required when `mode === 'one'`. Ignored for the other modes. */
  noteId?: string
  /** Only meaningful for `mode === 'stream'`. Default 100, max 500. */
  chunkSize?: number
}

// ─── v1.2 vault.events subscription protocol ─────────────────────────────
//
// Subscription model: the worker tells the host which vault events it
// wants by emitting `worker:subscribeVault` (carrying a worker-allocated
// `subscriptionId`). The host stores the (pluginId, subscriptionId,
// event) triple and starts dispatching `host:vaultChanged` /
// `host:noteSaved` / `host:activeNoteIdChanged` envelopes whose
// `subscriptionId` matches. To stop receiving events the worker emits
// `worker:unsubscribeVault` with the same id.
//
// Cleanup on plugin unload is automatic — the host drops every
// subscription whose pluginId matches when the worker is terminated, so
// a plugin that forgets to unsubscribe does not leak.
//
// vaultChanged is a coarse "something in the vault changed" signal the
// host emits at most every 250 ms (debounce). noteSaved carries the
// noteId whose body / title was updated; activeNoteIdChanged fires on
// editor-pane transitions and carries the new id (or null when no note
// is open).

/** Host telling the worker that the vault changed (any note added /
 *  updated / deleted / folder mutated). Coalesced at 250 ms; the worker
 *  must NOT count individual events for keystroke detection. */
export interface HostVaultChangedEvent {
  type: 'host:vaultChanged'
  seq: number
  subscriptionId: string
}

/** Host telling the worker that a specific note was saved (content /
 *  title / frontmatter change). Coalesced at 250 ms — back-to-back
 *  saves of the same id within the debounce window fire ONCE. */
export interface HostNoteSavedEvent {
  type: 'host:noteSaved'
  seq: number
  subscriptionId: string
  noteId: string
}

/** Host telling the worker that the active editor switched to a new
 *  note (or to no note). Coalesced at 250 ms. */
export interface HostActiveNoteIdChanged {
  type: 'host:activeNoteIdChanged'
  seq: number
  subscriptionId: string
  noteId: string | null
}

/** Worker subscribing to a vault event. The worker chooses the
 *  `subscriptionId` (uuid-ish) so it can pair host-delivered events
 *  with the in-worker handler that registered the subscription. The
 *  host treats the id as opaque. */
export interface WorkerSubscribeVault {
  type: 'worker:subscribeVault'
  seq: number
  event: 'vaultChanged' | 'noteSaved' | 'activeNoteIdChanged'
  subscriptionId: string
}

/** Worker dropping a subscription it previously registered. The host
 *  stops delivering events for that id. Idempotent — unknown ids are
 *  no-ops. */
export interface WorkerUnsubscribeVault {
  type: 'worker:unsubscribeVault'
  seq: number
  subscriptionId: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function isHostToWorker(msg: unknown): msg is HostToWorker {
  return isMessageOfType(msg, [
    'host:boot',
    'host:invokeCommand',
    'host:mountPanel',
    'host:unmountPanel',
    'host:renderCodeBlock',
    'host:activeNoteChanged',
    'host:fileSaveResult',
    'host:fileOpenResult',
    'host:vnodeEvent',
    'host:vaultReadResult',
    'host:vaultStreamChunk',
    'host:vaultChanged',
    'host:noteSaved',
    'host:activeNoteIdChanged',
  ])
}

export function isWorkerToHost(msg: unknown): msg is WorkerToHost {
  return isMessageOfType(msg, [
    'worker:ready',
    'worker:bootError',
    'worker:commandHandled',
    'worker:setPanelContent',
    'worker:renderResult',
    'worker:insertText',
    'worker:notify',
    'worker:error',
    'worker:requestFileSave',
    'worker:requestFileOpen',
    'worker:requestVaultRead',
    'worker:subscribeVault',
    'worker:unsubscribeVault',
  ])
}

function isMessageOfType(msg: unknown, allowed: string[]): boolean {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof (msg as { type?: unknown }).type === 'string' &&
    allowed.includes((msg as { type: string }).type) &&
    typeof (msg as { seq?: unknown }).seq === 'number'
  )
}
