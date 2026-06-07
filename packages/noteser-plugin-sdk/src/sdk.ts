// @noteser/plugin-sdk — seed.
//
// This file is the runtime entrypoint plugin authors import. Once the
// plugin platform stabilises (week 4 of the v1 plan), we extract it
// into a standalone npm package `@noteser/plugin-sdk` so plugins can
// `import { definePlugin } from '@noteser/plugin-sdk'` and publish
// without depending on noteser's repo.
//
// For now, plugins authored in this repo (the test plugin under
// `plugins/test-plugin/`) import from `@/plugins/sdk` instead. Same
// surface, same types — only the import specifier changes when we
// graduate.

import type { PluginManifest } from './manifest'

// ─── v1.2 VNode shapes ────────────────────────────────────────────────────
//
// These mirror the curated renderer in `src/plugins/PluginVNode.tsx`.
// The published SDK ships them as pure types so plugin authors can
// construct VNodes type-safely without depending on noteser's React
// renderer. The host re-validates every VNode at render time; the
// types are advisory, not load-bearing for security.

/**
 * Plugin-declared event intent. Functions cannot survive postMessage,
 * so plugins emit this record on `onClick` / `onChange` instead of a
 * callback. The host dispatches the event back through the wire
 * protocol; the worker matches by `event` name against handlers the
 * plugin registers via `ctx.onVNodeEvent` (registration ships in a
 * later v1.2 PR).
 */
export interface VNodeEvent {
  kind: 'emit'
  /** Plugin-defined event name. Host treats as opaque. */
  event: string
  /** Optional payload echoed back on the wire. */
  payload?: unknown
}

export interface VNodeText {
  tag: 'text'
  value: string
}

export interface VNodeCallout {
  tag: 'callout'
  kind?: 'note' | 'warn' | 'tip' | 'danger' | 'info'
  title?: string
  body: string
}

export interface VNodeButton {
  tag: 'button'
  label: string
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  onClick?: VNodeEvent
}

export interface VNodeInput {
  tag: 'input'
  type: 'text' | 'number' | 'search' | 'select'
  options?: ReadonlyArray<{ value: string; label: string }>
  value?: string | number
  placeholder?: string
  disabled?: boolean
  onChange?: VNodeEvent
}

export interface VNodeList {
  tag: 'list'
  ordered?: boolean
  items: ReadonlyArray<VNode>
}

export interface VNodeLink {
  tag: 'link'
  label: string
  /**
   * Discriminated union — the renderer constructs the real URL
   * host-side. Plugins cannot produce a raw href string, so
   * `javascript:`, `data:`, `mailto:`, and external URLs are
   * structurally impossible.
   */
  href:
    | { kind: 'note'; noteId: string }
    | { kind: 'anchor'; fragment: string }
}

export interface VNodeRadio {
  tag: 'radio'
  group: string
  options: ReadonlyArray<{ value: string; label: string }>
  value?: string
  onChange?: VNodeEvent
}

export type SvgChild =
  | { tag: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth?: number }
  | { tag: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; onClick?: VNodeEvent }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; onClick?: VNodeEvent }
  | { tag: 'text'; x: number; y: number; value: string; fontSize?: number; fill?: string }
  | { tag: 'path'; d: string; stroke?: string; fill?: string; strokeWidth?: number }

export interface VNodeSvg {
  tag: 'svg'
  width: number
  height: number
  viewBox?: readonly [number, number, number, number]
  children: ReadonlyArray<SvgChild>
}

export interface VNodeBox {
  tag: 'box'
  children: ReadonlyArray<VNode>
  gap?: 0 | 1 | 2 | 3 | 4
}

export type VNode =
  | VNodeText
  | VNodeCallout
  | VNodeButton
  | VNodeInput
  | VNodeList
  | VNodeLink
  | VNodeRadio
  | VNodeSvg
  | VNodeBox

/** A note's body + frontmatter as the host renders them. Returned by
 *  the v1.2 `ctx.vault.read.*` family. Strings only — the host never
 *  hands the worker raw bytes or a YAML string. */
export interface NoteWithBody {
  id: string
  title: string
  folderPath: string
  body: string
  /** Parsed by the host. `null` when the note has no frontmatter. */
  frontmatter: Readonly<Record<string, unknown>> | null
  updatedAt: number
}

/**
 * v1.2 — one entry returned by `ctx.fs.openDirectory`. See
 * docs/plugins-v1.2-plan.md section 4.3 in the noteser repo.
 *
 *  - `name` is the filename (no path prefix).
 *  - `path` is the forward-slash relative path inside the picked root.
 *  - `blob` lets the plugin read the file lazily via `blob.text()` or
 *    `blob.arrayBuffer()`. The host does not pre-load file bytes.
 */
export interface DirectoryEntry {
  name: string
  path: string
  blob: Blob
}

export type DirectoryEntries = ReadonlyArray<DirectoryEntry>


/** Narrow capability surface exposed to plugin handlers. The plugin
 *  never sees `localStorage`, the GitHub token, or the bodies of notes
 *  it is not currently viewing. v1 read scope is intentionally tight:
 *  active note + titles/paths of every other note. */
export interface PluginCtx {
  /** Currently-open note, or null when the welcome view is showing. */
  readonly activeNote: { id: string; title: string; content: string } | null
  /** All non-deleted notes — TITLES + PATHS only, not bodies. */
  readonly notes: ReadonlyArray<{ id: string; title: string; folderPath: string }>

  /** Replace the contents of one of this plugin's registered sidebar
   *  panels. The `node` is a curated virtual DOM (see week 2). */
  setPanelContent(panelId: string, node: unknown): void

  /** Render a code-block this plugin was asked to handle. Plugin calls
   *  this from inside `onRenderCodeBlock` to push the rendered tree
   *  back to the host. */
  renderCodeBlock(blockId: string, node: unknown): void

  /** Insert text into the active editor at the cursor. No-op when no
   *  note is open. */
  insertText(text: string): void

  /** Show a transient toast message to the user. */
  notify(message: string): void

  /** Per-plugin key/value storage. Namespaced by pluginId; one plugin
   *  cannot read another plugin's settings. */
  getSetting<T = unknown>(key: string): T | undefined
  setSetting<T = unknown>(key: string, value: T): void

  /** v1.1 file-I/O. Requires `permissions: ['file-save']`. */
  requestFileSave(args: { suggestedName: string; mimeType: string; bytes: Uint8Array }): Promise<void>
  /** v1.1 file-I/O. Requires `permissions: ['file-open']`. */
  requestFileOpen(args?: { accept?: string[] }): Promise<{ bytes: Uint8Array; filename: string } | null>

  /**
   * v1.2 vault namespace. Always populated; methods reject with
   * `'Permission "<name>" was not granted.'` (or `'... was revoked.'`)
   * when the plugin did not declare the matching permission OR the
   * user revoked it from Settings → Plugins. Plugins can catch and
   * degrade.
   *
   * PR C ships `read`; PR D ships `write`; PR F ships `events`.
   *
   * Spec reference: docs/plugins-v1.2-plan.md §4.1 (read),
   * §4.2 (write), §4.4 (events).
   */
  readonly vault: {
    readonly read: {
      /** Snapshot every non-deleted note in the vault. Resolves with a
       *  plain array of `NoteWithBody`. For very large vaults the host
       *  rejects with `'Vault too large; use stream().'`; plugins MUST
       *  fall back to `stream()` in that case.
       *
       *  Requires `vault.read.all` permission. */
      getAllNotes(): Promise<ReadonlyArray<NoteWithBody>>

      /** Resolve a single note by id. Returns null when the id is
       *  unknown or the note has been soft-deleted. Requires
       *  `vault.read.all` permission. */
      getNote(id: string): Promise<NoteWithBody | null>

      /** Paginate over the vault. Each iteration yields up to
       *  `chunkSize` notes (default 100, max 500). The iterator
       *  completes naturally when the vault is exhausted; it throws
       *  when the permission is revoked mid-stream.
       *
       *  Requires `vault.read.all` permission. */
      stream(opts?: { chunkSize?: number }): AsyncIterable<ReadonlyArray<NoteWithBody>>
    }
    readonly write: {
      /** Create a note. Returns the new note's id plus a
       *  `conflictResolved` flag: `'none'` when the title was used
       *  verbatim, `'suffix'` when " (imported)" was appended to
       *  avoid a title collision in the target folder. Requires
       *  `vault.write` permission. */
      createNote(args: {
        title: string
        body: string
        folderPath?: string
        frontmatter?: Record<string, unknown>
      }): Promise<{ id: string; conflictResolved: 'none' | 'suffix' }>
      /** Patch an existing note. Each field in `patch` is optional —
       *  omitted fields are left untouched. Requires `vault.write`. */
      updateNote(
        id: string,
        patch: {
          title?: string
          body?: string
          frontmatter?: Record<string, unknown>
        },
      ): Promise<void>
      /** Move a note to the trash (soft-delete only). Requires
       *  `vault.write` permission. */
      deleteNote(id: string): Promise<void>
      /** Create a folder at the given forward-slash-separated path
       *  (e.g. "Imported/Obsidian"). Missing intermediate folders are
       *  created. Idempotent. Requires `vault.write` permission. */
      createFolder(path: string): Promise<void>
    }
    readonly events: {
      /** Fires when any note in the vault changes (added / updated /
       *  trashed / restored). Requires `vault.events` permission.
       *  Returns an `Unsubscribe` thunk; the host also auto-unwinds
       *  every subscription on plugin unload. Debounced host-side at
       *  250 ms; per-event-type subscription cap is 16. */
      onVaultChange(handler: () => void): Unsubscribe
      /** Fires when a specific note's body / title / frontmatter is
       *  saved. Same debounce / cap rules as `onVaultChange`. */
      onNoteSaved(handler: (noteId: string) => void): Unsubscribe
      /** Fires when the editor moves to a different note (or to no
       *  note). Same debounce / cap rules as `onVaultChange`. */
      onActiveNoteChange(handler: (noteId: string | null) => void): Unsubscribe
    }
  }

  /**
   * v1.2 file-system namespace. Methods reject when the matching
   * permission was not granted (or was revoked from Settings →
   * Plugins) with the message
   * `Permission "fs.open-directory" was not granted.` Plugins can
   * catch and degrade.
   */
  fs: {
    /**
     * Open the native directory picker. Resolves with an array of
     * `{ name, path, blob }` for every file under the picked root, or
     * `null` when the user cancelled.
     *
     * Requires `permissions: ['fs.open-directory']` in the manifest.
     *
     *  - `args.extensions` (case-insensitive, leading dot optional):
     *    filters the response to entries whose name ends with one of
     *    the listed suffixes, e.g. `['.md', '.markdown']`. Empty /
     *    undefined returns every file.
     *
     * Rejects with `Directory too large` when the picked folder
     * contains more than 50,000 entries.
     */
    openDirectory(args?: { extensions?: string[] }): Promise<DirectoryEntries | null>
  }

  /**
   * v1.2 — register a handler for every VNode event a rendered surface
   * fires back. The renderer attached event intents to VNode shapes
   * (`{ kind: 'emit', event, payload? }` on a button's `onClick`, a
   * radio's `onChange`, etc.); the host packages those firings into
   * `host:vnodeEvent` envelopes and the worker dispatches them here.
   *
   * `source` tells the handler WHICH rendered surface produced the
   * event so a plugin that uses the same event name in two surfaces
   * (e.g. a "save" button in both the sidebar panel and a fullscreen
   * modal) can disambiguate without renaming.
   *
   * Multiple registrations stack — every handler fires for every
   * event. Returns an `Unsubscribe` thunk; the host also auto-drops
   * every handler on plugin unload (the worker itself is terminated).
   *
   * Backwards-compatible: existing v1.2 plugins that never call this
   * API see no behaviour change — events fired by their rendered
   * controls are simply discarded by the worker.
   */
  onVNodeEvent(
    handler: (args: {
      event: string
      payload: unknown
      source:
        | { kind: 'panel'; panelId: string }
        | { kind: 'codeBlock'; blockId: string }
        | { kind: 'fullscreen'; viewId: string }
    }) => void,
  ): Unsubscribe

  /**
   * v1.2 PR B — request that the host mount one of this plugin's
   * declared fullscreen views. The view id must appear in
   * `surfaces.fullscreenViews` of the manifest. Only one fullscreen
   * view is open at a time across the whole app; if another one is
   * already open the Promise rejects with a clear message.
   *
   * Once the modal mounts, the plugin's `onFullscreenMount` handler
   * fires and the plugin should populate content with
   * `setFullscreenContent`. The modal stays open across active-note
   * changes — the plugin is in control and decides when to close.
   */
  openFullscreen(viewId: string): Promise<void>

  /**
   * v1.2 PR B — close the currently-mounted fullscreen view. No-op
   * when no view is open or when the id does not match.
   */
  closeFullscreen(viewId: string): void

  /**
   * v1.2 PR B — replace the content tree of the named fullscreen
   * view. Same VNode contract as `setPanelContent`.
   */
  setFullscreenContent(viewId: string, node: VNode): void
}

/** Cleanup thunk returned by every `vault.events` subscription. The
 *  plugin must call this when it no longer needs the events; the host
 *  ALSO calls every outstanding unsubscribe when the plugin unloads. */
export type Unsubscribe = () => void

export interface PluginHandlers {
  /** Optional — fires after the worker boots and the manifest validates. */
  onActivate?: (ctx: PluginCtx) => void | Promise<void>

  /** Fires when a registered command is invoked from the palette or
   *  via shortcut. `id` is the local command id, not the namespaced
   *  `<pluginId>.<commandId>` form the host uses internally. */
  onCommand?: (id: string, ctx: PluginCtx) => void | Promise<void>

  /** Fires when one of this plugin's sidebar panels is opened. The
   *  plugin should set up state + call ctx.setPanelContent. */
  onPanelMount?: (panelId: string, ctx: PluginCtx) => void | Promise<void>

  /** Fires when a previously-mounted panel is closed. */
  onPanelUnmount?: (panelId: string, ctx: PluginCtx) => void | Promise<void>

  /** Fires when the active note changes. Plugins can re-render any
   *  note-dependent panel here. */
  onActiveNoteChange?: (
    note: { id: string; title: string; content: string } | null,
    ctx: PluginCtx,
  ) => void | Promise<void>

  /** Fires when a markdown render encounters a code block in one of
   *  this plugin's claimed languages. The handler must call
   *  `ctx.renderCodeBlock(blockId, vdom)` synchronously OR within an
   *  async block that resolves quickly; the host shows a placeholder
   *  while it waits. */
  onRenderCodeBlock?: (
    args: { language: string; source: string; blockId: string },
    ctx: PluginCtx,
  ) => void | Promise<void>

  /** v1.2 PR B — fires after the host mounts a fullscreen view in
   *  response to `ctx.openFullscreen(viewId)`. */
  onFullscreenMount?: (viewId: string, ctx: PluginCtx) => void | Promise<void>

  /** v1.2 PR B — fires after the host unmounts a fullscreen view. */
  onFullscreenUnmount?: (viewId: string, ctx: PluginCtx) => void | Promise<void>
}

export interface PluginDefinition extends PluginManifest, PluginHandlers {}

/** The single public function plugin authors call from their main
 *  module. Pass-through at runtime — the host re-validates the
 *  manifest before honouring anything.
 *
 *  Plugin entry pattern:
 *
 *    import { definePlugin } from '@noteser/plugin-sdk'
 *
 *    export default definePlugin({
 *      id: 'word-count',
 *      name: 'Word count',
 *      version: '1.0.0',
 *      surfaces: { sidebarPanels: [{ id: 'wc', title: 'Word count' }] },
 *      onPanelMount(panelId, ctx) { ... },
 *    })
 */
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def
}
