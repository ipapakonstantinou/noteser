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

// Re-export the v1.2 VNode types so plugin authors importing from the
// SDK can construct VNodes type-safely. PR A only adds the types —
// new SDK methods (event registration, fullscreen, vault, fs) ship in
// later v1.2 PRs.
export type {
  VNode,
  VNodeText,
  VNodeCallout,
  VNodeButton,
  VNodeInput,
  VNodeList,
  VNodeLink,
  VNodeRadio,
  VNodeSvg,
  VNodeBox,
  VNodeEvent,
  SvgChild,
} from './PluginVNode'

/** A note's body + frontmatter as the host renders them. Returned by
 *  the v1.2 `ctx.vault.read.*` family. Strings only — the host never
 *  hands the worker a `Uint8Array` (postMessage clones it) or a raw
 *  YAML string (the worker would have to re-parse, opening a fresh
 *  parser-bug surface). */
export interface NoteWithBody {
  id: string
  title: string
  folderPath: string
  body: string
  /** Parsed by the host. `null` when the note has no frontmatter. */
  frontmatter: Readonly<Record<string, unknown>> | null
  updatedAt: number
}

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

  /**
   * v1.1 capability: open the native save dialog and write `bytes` to
   * the user-picked file. Requires the manifest to declare
   * `permissions: ['file-save']` AND the user to grant it at install.
   *
   * Rejects if the permission was not granted, the user cancelled, or
   * the browser does not support the File System Access API.
   */
  requestFileSave(args: { suggestedName: string; mimeType: string; bytes: Uint8Array }): Promise<void>

  /**
   * v1.1 capability: open the native file picker. Resolves with the
   * picked file's bytes + filename, or null when the user cancelled.
   * Requires `permissions: ['file-open']`.
   *
   * `accept` filters the picker by MIME type or extension, e.g.
   * `['.pdf', 'application/pdf']`.
   */
  requestFileOpen(args?: { accept?: string[] }): Promise<{ bytes: Uint8Array; filename: string } | null>

  /**
   * v1.2 vault namespace. Always populated; methods reject when the
   * matching permission was not granted or has been revoked. Plugins
   * can catch and degrade. PR C wires the `read` sub-namespace; PRs
   * D / F introduce `write` and `events` later.
   *
   * Spec reference: docs/plugins-v1.2-plan.md §4.1.
   */
  vault: {
    read: {
      /**
       * Snapshot every non-deleted note in the vault. Resolves with a
       * plain array of `NoteWithBody`. For very large vaults the host
       * rejects with `'Vault too large; use stream().'`; plugins MUST
       * fall back to `stream()` in that case.
       *
       * Requires `vault.read.all` permission.
       */
      getAllNotes(): Promise<ReadonlyArray<NoteWithBody>>

      /** Resolve a single note by id. Returns null when the id is
       *  unknown or the note has been soft-deleted. Requires
       *  `vault.read.all` permission. */
      getNote(id: string): Promise<NoteWithBody | null>

      /**
       * Paginate over the vault. Each iteration yields up to
       * `chunkSize` notes (default 100, max 500). The iterator
       * completes naturally when the vault is exhausted; it throws
       * when the permission is revoked mid-stream.
       *
       * Requires `vault.read.all` permission.
       */
      stream(opts?: { chunkSize?: number }): AsyncIterable<ReadonlyArray<NoteWithBody>>
    }
  }
}

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
