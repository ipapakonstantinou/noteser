// Main-thread orchestrator. Owns one Web Worker per installed plugin,
// translates host events (user invoked a command, opened a panel, etc.)
// into worker messages, and translates worker responses back into host
// state updates.
//
// One PluginHost instance lives at the noteser app root, alongside the
// Zustand stores. The instance is created lazily on first plugin load
// (so SSR + the cold welcome path do not pay the cost).

import {
  isWorkerToHost,
  MAX_ENVELOPE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  MAX_VNODE_EVENTS_PER_SECOND,
  VAULT_EVENT_DEBOUNCE_MS,
  type HostToWorker,
  type HostVNodeEvent,
  type WorkerToHost,
  type NoteWithBodyWire,
} from './protocol'
import type { PluginManifest, PluginPermission } from './manifest'

export interface InstalledPlugin {
  manifest: PluginManifest
  /** Last time the worker emitted a message — used by the rate limiter. */
  lastMessageWindowStart: number
  messagesInWindow: number
  /** undefined when the plugin is loaded but not yet ready (boot in
   *  flight); set once worker:ready arrives. */
  ready: boolean
  /** Capability identifiers the user has REVOKED at runtime, after the
   *  plugin was already installed. The manifest's `permissions` list is
   *  the declared grant; this set wins over it. Used by the Settings →
   *  Plugins revocation toggle (v1.2). The host treats a revoked
   *  capability as if it was never granted and replies with
   *  `Permission "<name>" was revoked.` to the next call. */
  revokedPermissions: Set<PluginPermission>
}

export interface PluginHostOptions {
  /** Override Worker constructor for testing — a fake Worker that
   *  echoes messages back synchronously. Production uses the real
   *  global Worker.
   *
   *  The factory takes no arguments and must return something that
   *  conforms to the MinimalWorker interface (postMessage +
   *  onmessage + terminate). In production this points at the
   *  bundled `workerEntry.ts` module via `new URL(..., import.meta.url)`
   *  — see `pluginHostSingleton.ts`. */
  createWorker?: () => MinimalWorker
  /** Look up whether a permission has been revoked for a plugin at
   *  Settings level. Re-checked on every vault.events dispatch so a
   *  user toggling the permission off makes the handler stop firing
   *  without restarting the plugin (the existing subscriber's
   *  unsubscribe is still callable; it just receives no events). */
  isPermissionRevoked?: (pluginId: string, permission: PluginPermission) => boolean
}

export interface MinimalWorker {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((event: MessageEvent) => void) | null
  onerror?: ((event: ErrorEvent) => void) | null
}

export type PluginHostListener = (event: PluginHostEvent) => void

export type PluginHostEvent =
  | { type: 'ready'; pluginId: string; manifest: PluginManifest }
  | { type: 'bootError'; pluginId: string; message: string }
  | { type: 'panelContent'; pluginId: string; panelId: string; node: unknown }
  | { type: 'renderResult'; pluginId: string; blockId: string; node: unknown }
  | { type: 'insertText'; pluginId: string; text: string }
  | { type: 'notify'; pluginId: string; message: string }
  | { type: 'commandHandled'; pluginId: string; commandId: string; error?: string }
  | { type: 'workerError'; pluginId: string; message: string }
  | {
      type: 'fileSaveRequested'
      pluginId: string
      requestSeq: number
      suggestedName: string
      mimeType: string
      bytesBase64: string
    }
  | {
      type: 'fileOpenRequested'
      pluginId: string
      requestSeq: number
      accept?: string[]
    }
  | {
      type: 'vaultReadRequested'
      pluginId: string
      requestSeq: number
      mode: 'all' | 'one' | 'stream'
      noteId?: string
      chunkSize?: number
    }
  | {
      type: 'directoryOpenRequested'
      pluginId: string
      requestSeq: number
      extensions?: string[]
    }
  | {
      type: 'fullscreenOpenRequested'
      pluginId: string
      requestSeq: number
      viewId: string
    }
  | { type: 'fullscreenCloseRequested'; pluginId: string; viewId: string }
  | {
      type: 'fullscreenContent'
      pluginId: string
      viewId: string
      node: unknown
    }
  | {
      type: 'vaultWriteRequested'
      pluginId: string
      requestSeq: number
      op: VaultWriteOp
    }
  | { type: 'rateLimited'; pluginId: string }
  | { type: 'vnodeEventRateLimited'; pluginId: string }

/** Discriminated union over the four vault.write ops carried in a
 *  `worker:requestVaultWrite` envelope. Identical shape to the wire
 *  protocol's `op` field — re-exported here so the singleton's
 *  vault-write handler can switch on it without re-importing the
 *  protocol module. */
export type VaultWriteOp =
  | {
      kind: 'create'
      title: string
      body: string
      folderPath?: string
      frontmatter?: Record<string, unknown>
    }
  | {
      kind: 'update'
      id: string
      title?: string
      body?: string
      frontmatter?: Record<string, unknown>
    }
  | { kind: 'delete'; id: string }
  | { kind: 'createFolder'; path: string }

interface WorkerEntry {
  plugin: InstalledPlugin
  worker: MinimalWorker
  /** Vault-events subscriptions the worker has registered. Cleared on
   *  unload; the host drops every entry whose pluginId matches. */
  vaultSubs: Map<string, VaultSubscription>
  /** Per-event-type debounce timers + pending coalesced payload. Each
   *  event type has at most one in-flight timer for the lifetime of
   *  the entry. */
  vaultDebounce: {
    vaultChanged: PendingEvent<null>
    noteSaved: PendingEvent<Set<string>>
    activeNoteIdChanged: PendingEvent<{ noteId: string | null }>
  }
  /** Per-plugin VNode event rate-limit window. The host forwards at
   *  most `MAX_VNODE_EVENTS_PER_SECOND` host:vnodeEvent envelopes per
   *  1-second sliding window. The first event past the cap also emits
   *  a `vnodeEventRateLimited` PluginHostEvent so the dev console can
   *  spot a runaway loop. */
  vnodeEventWindowStart: number
  vnodeEventsInWindow: number
  vnodeEventRateLimitWarned: boolean
}

interface VaultSubscription {
  event: VaultEventName
  subscriptionId: string
}

type VaultEventName = 'vaultChanged' | 'noteSaved' | 'activeNoteIdChanged'

interface PendingEvent<P> {
  timer: ReturnType<typeof setTimeout> | null
  payload: P | null
}

function makePendingState(): WorkerEntry['vaultDebounce'] {
  return {
    vaultChanged: { timer: null, payload: null },
    noteSaved: { timer: null, payload: null },
    activeNoteIdChanged: { timer: null, payload: null },
  }
}

export class PluginHost {
  private readonly workers = new Map<string, WorkerEntry>()
  private readonly listeners = new Set<PluginHostListener>()
  private seqCounter = 0
  private readonly opts: PluginHostOptions

  constructor(opts: PluginHostOptions = {}) {
    this.opts = opts
  }

  /** Subscribe to host events (panel content updates, notify toasts,
   *  command-handled acks, etc). Returns an unsubscribe function. */
  on(listener: PluginHostListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** True when this plugin id has a worker spawned (regardless of
   *  whether it has reached ready). */
  isLoaded(pluginId: string): boolean {
    return this.workers.has(pluginId)
  }

  /** Return the manifest of an already-loaded plugin, or undefined. */
  getManifest(pluginId: string): PluginManifest | undefined {
    return this.workers.get(pluginId)?.plugin.manifest
  }

  /** Snapshot of currently-ready plugins. */
  listReady(): InstalledPlugin[] {
    return Array.from(this.workers.values())
      .filter((e) => e.plugin.ready)
      .map((e) => e.plugin)
  }

  /**
   * Load and boot a plugin from its source. Resolves once worker:ready
   * arrives, rejects on bootError or timeout.
   *
   * The Worker is constructed via `opts.createWorker`. In production
   * that points at the bundled `workerEntry.ts` module; in tests it
   * returns a FakeWorker that echoes canned replies.
   *
   * The plugin source is shipped to the worker as the `host:boot`
   * payload — the worker dynamic-imports it via a Blob URL.
   */
  async load(args: {
    pluginId: string
    pluginSource: string
    timeoutMs?: number
  }): Promise<PluginManifest> {
    const { pluginId, pluginSource } = args
    const timeoutMs = args.timeoutMs ?? 5000

    if (this.workers.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" already loaded.`)
    }

    const worker = (this.opts.createWorker ?? defaultCreateWorker)()
    const plugin: InstalledPlugin = {
      manifest: { id: pluginId, name: pluginId, version: '0.0.0', surfaces: {} },
      lastMessageWindowStart: nowMs(),
      messagesInWindow: 0,
      ready: false,
      revokedPermissions: new Set<PluginPermission>(),
    }
    const entry: WorkerEntry = {
      plugin,
      worker,
      vaultSubs: new Map(),
      vaultDebounce: makePendingState(),
      vnodeEventWindowStart: nowMs(),
      vnodeEventsInWindow: 0,
      vnodeEventRateLimitWarned: false,
    }
    this.workers.set(pluginId, entry)

    return new Promise<PluginManifest>((resolve, reject) => {
      const bootSeq = ++this.seqCounter
      const timer = setTimeout(() => {
        this.unload(pluginId)
        reject(new Error(`Plugin "${pluginId}" boot timed out after ${timeoutMs} ms.`))
      }, timeoutMs)

      worker.onmessage = (ev) => this.handleWorkerMessage(pluginId, ev, {
        onReady: (manifest) => {
          clearTimeout(timer)
          plugin.manifest = manifest
          plugin.ready = true
          this.emit({ type: 'ready', pluginId, manifest })
          resolve(manifest)
        },
        onBootError: (message) => {
          clearTimeout(timer)
          this.unload(pluginId)
          this.emit({ type: 'bootError', pluginId, message })
          reject(new Error(message))
        },
      })

      if (worker.onerror !== undefined) {
        worker.onerror = (ev) => {
          clearTimeout(timer)
          this.unload(pluginId)
          const message = ev.message || 'Worker error'
          this.emit({ type: 'bootError', pluginId, message })
          reject(new Error(message))
        }
      }

      worker.postMessage({
        type: 'host:boot',
        seq: bootSeq,
        pluginId,
        source: pluginSource,
      } satisfies HostToWorker)
    })
  }

  /** Terminate a plugin's worker and forget it. Also drops every
   *  vault.events subscription the worker had open and cancels any
   *  in-flight debounce timer — a forgotten unsubscribe in the plugin
   *  cannot leak across reboots. */
  unload(pluginId: string): void {
    const entry = this.workers.get(pluginId)
    if (!entry) return
    this.clearVaultDebounce(entry)
    entry.vaultSubs.clear()
    try {
      entry.worker.terminate()
    } catch {
      // Some test fakes do not implement terminate; ignore.
    }
    this.workers.delete(pluginId)
  }

  /** Inspect — used by tests to assert subscription cleanup. Returns
   *  the count of active vault.events subscriptions across every loaded
   *  plugin. */
  vaultSubscriptionCount(): number {
    let n = 0
    for (const e of this.workers.values()) n += e.vaultSubs.size
    return n
  }

  /** Inspect — used by tests. Subscriptions for a single plugin. */
  vaultSubscriptionCountForPlugin(pluginId: string): number {
    return this.workers.get(pluginId)?.vaultSubs.size ?? 0
  }

  /** User picked one of the plugin's commands from the palette. */
  invokeCommand(pluginId: string, commandId: string): void {
    this.send(pluginId, {
      type: 'host:invokeCommand',
      seq: ++this.seqCounter,
      commandId,
    })
  }

  /** Sidebar opened the plugin's panel. */
  mountPanel(pluginId: string, panelId: string): void {
    this.send(pluginId, {
      type: 'host:mountPanel',
      seq: ++this.seqCounter,
      panelId,
    })
  }

  /** Sidebar closed the plugin's panel. */
  unmountPanel(pluginId: string, panelId: string): void {
    this.send(pluginId, {
      type: 'host:unmountPanel',
      seq: ++this.seqCounter,
      panelId,
    })
  }

  /** Editor switched to a new note (or no note). The full body is
   *  forwarded since the v1 capability model allows plugins to read
   *  the active note's content. */
  activeNoteChanged(
    pluginId: string,
    note: { id: string; title: string; folderPath: string; content: string } | null,
  ): void {
    this.send(pluginId, {
      type: 'host:activeNoteChanged',
      seq: ++this.seqCounter,
      note,
    })
  }

  /** Markdown renderer asking a plugin to draw a fenced code block. */
  renderCodeBlock(
    pluginId: string,
    args: { language: string; source: string; blockId: string },
  ): void {
    this.send(pluginId, {
      type: 'host:renderCodeBlock',
      seq: ++this.seqCounter,
      language: args.language,
      source: args.source,
      blockId: args.blockId,
    })
  }

  /**
   * v1.2 — forward a VNode event from a rendered surface (panel,
   * fullscreen modal, code-block) into the plugin's worker. The
   * worker's `host:vnodeEvent` handler routes the event to whatever
   * the plugin registered via `ctx.onVNodeEvent`.
   *
   * Rate-limited per plugin at `MAX_VNODE_EVENTS_PER_SECOND` over a
   * 1-second sliding window. Events past the cap are silently dropped
   * on the host side; the first drop within a window also emits a
   * `vnodeEventRateLimited` PluginHostEvent (one per window) so the
   * dev console can flag a runaway loop without spamming the user.
   *
   * No-op when the plugin is not loaded. The `source` discriminator
   * follows the wire shape in `protocol.ts:HostVNodeEvent` exactly —
   * the renderer-side surfaces (`PluginsPanel`, `PluginFullscreenView`,
   * `PluginCodeBlock`) wrap this call with their own source descriptor.
   */
  sendVNodeEvent(
    pluginId: string,
    source: HostVNodeEvent['source'],
    event: string,
    payload: unknown,
  ): void {
    const entry = this.workers.get(pluginId)
    if (!entry) return
    if (typeof event !== 'string' || event.length === 0) return

    const now = nowMs()
    if (now - entry.vnodeEventWindowStart >= 1000) {
      entry.vnodeEventWindowStart = now
      entry.vnodeEventsInWindow = 0
      entry.vnodeEventRateLimitWarned = false
    }
    entry.vnodeEventsInWindow++
    if (entry.vnodeEventsInWindow > MAX_VNODE_EVENTS_PER_SECOND) {
      if (!entry.vnodeEventRateLimitWarned) {
        entry.vnodeEventRateLimitWarned = true
        this.emit({ type: 'vnodeEventRateLimited', pluginId })
      }
      return
    }

    this.send(pluginId, {
      type: 'host:vnodeEvent',
      seq: ++this.seqCounter,
      event,
      payload,
      source,
    })
  }

  /**
   * Settings → Plugins toggles per-capability grants here. Marks the
   * permission as revoked for the loaded plugin; subsequent capability
   * calls reject with `'Permission "<name>" was revoked.'`. The
   * manifest's declared permission list is unchanged — revocation is
   * runtime-only and resets on app boot.
   *
   * Pre-existing pending requests (e.g. a `getAllNotes()` Promise
   * already in flight) complete via the same response envelope; if
   * they have not yet been answered the host short-circuits them with
   * the same revocation error.
   */
  revokePermission(pluginId: string, permission: PluginPermission): void {
    const entry = this.workers.get(pluginId)
    if (!entry) return
    entry.plugin.revokedPermissions.add(permission)
  }

  /** Inverse of `revokePermission`. Lets the Settings toggle restore a
   *  capability without re-installing the plugin. */
  restorePermission(pluginId: string, permission: PluginPermission): void {
    const entry = this.workers.get(pluginId)
    if (!entry) return
    entry.plugin.revokedPermissions.delete(permission)
  }

  /** True when the manifest declared the capability AND the user has
   *  not revoked it at runtime. The Settings panel reads this to
   *  decide whether to render the toggle as on or off. */
  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    const entry = this.workers.get(pluginId)
    if (!entry) return false
    const declared = entry.plugin.manifest.permissions?.includes(permission) ?? false
    if (!declared) return false
    return !entry.plugin.revokedPermissions.has(permission)
  }

  // ── v1.2 vault.events fan-out ───────────────────────────────────────────
  //
  // The singleton glue calls these when the underlying noteStore /
  // workspaceStore mutates. The host walks every loaded plugin, checks
  // the `vault.events` permission, and posts a coalesced debounced
  // envelope per subscription.

  /** Coarse "something in the vault changed" pulse. Called by the
   *  pluginHostSingleton on every noteStore or folderStore mutation.
   *  Coalesced at `VAULT_EVENT_DEBOUNCE_MS` per (plugin, subscription)
   *  pair. */
  notifyVaultChanged(): void {
    for (const entry of this.workers.values()) {
      if (!this.isVaultEventsAllowed(entry)) continue
      if (!hasSub(entry, 'vaultChanged')) continue
      this.scheduleVaultEvent(entry, 'vaultChanged', null)
    }
  }

  /** Note-save pulse. Carries the note id so plugins can re-derive
   *  cheaply. Multiple saves of the same id within the debounce
   *  window collapse into one envelope; saves of different ids fan
   *  out as one envelope per id at the trailing edge. */
  notifyNoteSaved(noteId: string): void {
    for (const entry of this.workers.values()) {
      if (!this.isVaultEventsAllowed(entry)) continue
      if (!hasSub(entry, 'noteSaved')) continue
      const pending = entry.vaultDebounce.noteSaved
      if (!pending.payload) pending.payload = new Set<string>()
      pending.payload.add(noteId)
      this.scheduleVaultEvent(entry, 'noteSaved', pending.payload)
    }
  }

  /** Active-note transition. Coalesced — back-to-back switches keep
   *  only the most recent id. */
  notifyActiveNoteIdChanged(noteId: string | null): void {
    for (const entry of this.workers.values()) {
      if (!this.isVaultEventsAllowed(entry)) continue
      if (!hasSub(entry, 'activeNoteIdChanged')) continue
      this.scheduleVaultEvent(entry, 'activeNoteIdChanged', { noteId })
    }
  }

  /** Internal — re-checked on every dispatch so a settings-level
   *  revocation takes effect without restarting the plugin. The in-host
   *  `revokedPermissions` set (populated by PR C from the install
   *  store) is the canonical source; `opts.isPermissionRevoked` is the
   *  test-side override that lets a fake host inject revocation without
   *  spinning up the store. */
  private isVaultEventsAllowed(entry: WorkerEntry): boolean {
    const granted = entry.plugin.manifest.permissions?.includes('vault.events') ?? false
    if (!granted) return false
    if (entry.plugin.revokedPermissions.has('vault.events')) return false
    const optRevoked =
      this.opts.isPermissionRevoked?.(entry.plugin.manifest.id, 'vault.events') ?? false
    return !optRevoked
  }

  private scheduleVaultEvent<E extends VaultEventName>(
    entry: WorkerEntry,
    event: E,
    payload: WorkerEntry['vaultDebounce'][E]['payload'],
  ): void {
    const slot = entry.vaultDebounce[event] as PendingEvent<unknown>
    slot.payload = payload as unknown
    if (slot.timer !== null) return // existing trailing-edge timer will pick up the latest payload
    slot.timer = setTimeout(() => {
      slot.timer = null
      const finalPayload = slot.payload
      slot.payload = null
      this.flushVaultEvent(entry, event, finalPayload)
    }, VAULT_EVENT_DEBOUNCE_MS)
  }

  private flushVaultEvent(entry: WorkerEntry, event: VaultEventName, payload: unknown): void {
    const pluginId = entry.plugin.manifest.id
    // Re-check permission at flush time so a Settings revocation that
    // landed during the debounce window still suppresses delivery.
    if (!this.isVaultEventsAllowed(entry)) return
    for (const sub of entry.vaultSubs.values()) {
      if (sub.event !== event) continue
      switch (event) {
        case 'vaultChanged':
          this.send(pluginId, {
            type: 'host:vaultChanged',
            seq: ++this.seqCounter,
            subscriptionId: sub.subscriptionId,
          })
          break
        case 'noteSaved': {
          const ids = (payload as Set<string> | null) ?? new Set<string>()
          for (const noteId of ids) {
            this.send(pluginId, {
              type: 'host:noteSaved',
              seq: ++this.seqCounter,
              subscriptionId: sub.subscriptionId,
              noteId,
            })
          }
          break
        }
        case 'activeNoteIdChanged': {
          const p = (payload as { noteId: string | null } | null) ?? { noteId: null }
          this.send(pluginId, {
            type: 'host:activeNoteIdChanged',
            seq: ++this.seqCounter,
            subscriptionId: sub.subscriptionId,
            noteId: p.noteId,
          })
          break
        }
      }
    }
  }

  private clearVaultDebounce(entry: WorkerEntry): void {
    for (const slot of [
      entry.vaultDebounce.vaultChanged,
      entry.vaultDebounce.noteSaved,
      entry.vaultDebounce.activeNoteIdChanged,
    ]) {
      if (slot.timer !== null) clearTimeout(slot.timer)
      slot.timer = null
      slot.payload = null
    }
  }

  // ── private ─────────────────────────────────────────────────────────────

  private send(pluginId: string, message: HostToWorker): void {
    const entry = this.workers.get(pluginId)
    if (!entry) return
    try {
      entry.worker.postMessage(message)
    } catch (err) {
      this.emit({
        type: 'workerError',
        pluginId,
        message: err instanceof Error ? err.message : 'postMessage failed',
      })
    }
  }

  private handleWorkerMessage(
    pluginId: string,
    event: MessageEvent,
    bootCallbacks: {
      onReady: (manifest: PluginManifest) => void
      onBootError: (message: string) => void
    },
  ): void {
    const entry = this.workers.get(pluginId)
    if (!entry) return

    // Rate-limit per plugin. 1-second sliding window.
    const now = nowMs()
    if (now - entry.plugin.lastMessageWindowStart >= 1000) {
      entry.plugin.lastMessageWindowStart = now
      entry.plugin.messagesInWindow = 0
    }
    entry.plugin.messagesInWindow++
    if (entry.plugin.messagesInWindow > MAX_MESSAGES_PER_SECOND) {
      this.emit({ type: 'rateLimited', pluginId })
      return
    }

    // Envelope-size guard. JSON-serialise to compare; same shape the
    // structured clone uses to encode.
    const sizeBytes = estimateSize(event.data)
    if (sizeBytes > MAX_ENVELOPE_BYTES) {
      this.emit({
        type: 'workerError',
        pluginId,
        message: `Envelope too large: ${sizeBytes} > ${MAX_ENVELOPE_BYTES} bytes`,
      })
      return
    }

    if (!isWorkerToHost(event.data)) {
      this.emit({
        type: 'workerError',
        pluginId,
        message: 'Worker emitted an unrecognised message shape.',
      })
      return
    }

    const msg = event.data as WorkerToHost
    switch (msg.type) {
      case 'worker:ready':
        bootCallbacks.onReady(msg.manifest)
        return
      case 'worker:bootError':
        bootCallbacks.onBootError(msg.message)
        return
      case 'worker:commandHandled':
        this.emit({
          type: 'commandHandled',
          pluginId,
          commandId: msg.commandId,
          error: msg.error,
        })
        return
      case 'worker:setPanelContent':
        this.emit({ type: 'panelContent', pluginId, panelId: msg.panelId, node: msg.node })
        return
      case 'worker:renderResult':
        this.emit({ type: 'renderResult', pluginId, blockId: msg.blockId, node: msg.node })
        return
      case 'worker:insertText':
        this.emit({ type: 'insertText', pluginId, text: msg.text })
        return
      case 'worker:notify':
        this.emit({ type: 'notify', pluginId, message: msg.message })
        return
      case 'worker:error':
        this.emit({ type: 'workerError', pluginId, message: msg.message })
        return

      case 'worker:requestFileSave': {
        // Permission gate. Plugins MUST declare `file-save` in the
        // manifest AND the user grants it at install. Anything not
        // declared gets refused before the picker ever shows.
        const granted = entry.plugin.manifest.permissions?.includes('file-save') ?? false
        if (!granted) {
          this.respondFileSave(pluginId, msg.seq, {
            ok: false,
            error: 'Plugin did not declare the `file-save` permission.',
          })
          return
        }
        if (entry.plugin.revokedPermissions.has('file-save')) {
          this.respondFileSave(pluginId, msg.seq, {
            ok: false,
            error: 'Permission "file-save" was revoked.',
          })
          return
        }
        this.emit({
          type: 'fileSaveRequested',
          pluginId,
          requestSeq: msg.seq,
          suggestedName: msg.suggestedName,
          mimeType: msg.mimeType,
          bytesBase64: msg.bytesBase64,
        })
        return
      }

      case 'worker:subscribeVault': {
        // Permission gate. Plugin MUST declare `vault.events` in the
        // manifest. We still accept the subscribe so cleanup logic is
        // uniform (the worker tracks an unsubscribe even when it never
        // received any event), but never deliver events.
        const granted = entry.plugin.manifest.permissions?.includes('vault.events') ?? false
        if (!granted) {
          this.emit({
            type: 'workerError',
            pluginId,
            message: 'Plugin did not declare the `vault.events` permission; subscription will receive no events.',
          })
          return
        }
        entry.vaultSubs.set(msg.subscriptionId, {
          event: msg.event,
          subscriptionId: msg.subscriptionId,
        })
        return
      }

      case 'worker:unsubscribeVault':
        entry.vaultSubs.delete(msg.subscriptionId)
        return

      case 'worker:requestFileOpen': {
        const granted = entry.plugin.manifest.permissions?.includes('file-open') ?? false
        if (!granted) {
          this.respondFileOpen(pluginId, msg.seq, {
            ok: false,
            error: 'Plugin did not declare the `file-open` permission.',
          })
          return
        }
        if (entry.plugin.revokedPermissions.has('file-open')) {
          this.respondFileOpen(pluginId, msg.seq, {
            ok: false,
            error: 'Permission "file-open" was revoked.',
          })
          return
        }
        this.emit({
          type: 'fileOpenRequested',
          pluginId,
          requestSeq: msg.seq,
          ...(msg.accept ? { accept: msg.accept } : {}),
        })
        return
      }

      case 'worker:requestVaultRead': {
        // v1.2 capability — every mode is gated on the same
        // `vault.read.all` permission. Two layers:
        //   1. declared at install: rejected with "did not declare".
        //   2. declared but revoked at runtime: rejected with "revoked".
        // The plugin sees the same Promise rejection either way, but
        // the error string is distinct so the dev console clarifies.
        const declared = entry.plugin.manifest.permissions?.includes('vault.read.all') ?? false
        if (!declared) {
          this.respondVaultReadError(
            pluginId,
            msg.seq,
            msg.mode,
            'Plugin did not declare the `vault.read.all` permission.',
          )
          return
        }
        if (entry.plugin.revokedPermissions.has('vault.read.all')) {
          this.respondVaultReadError(
            pluginId,
            msg.seq,
            msg.mode,
            'Permission "vault.read.all" was revoked.',
          )
          return
        }
        if (msg.mode === 'one' && typeof msg.noteId !== 'string') {
          this.respondVaultReadError(
            pluginId,
            msg.seq,
            msg.mode,
            'vault.read.getNote requires a string id.',
          )
          return
        }
        this.emit({
          type: 'vaultReadRequested',
          pluginId,
          requestSeq: msg.seq,
          mode: msg.mode,
          ...(typeof msg.noteId === 'string' ? { noteId: msg.noteId } : {}),
          ...(typeof msg.chunkSize === 'number' ? { chunkSize: msg.chunkSize } : {}),
        })
        return
      }

      case 'worker:requestDirectoryOpen': {
        // v1.2 capability — gated like vault.read.all. Manifest must
        // declare the permission; runtime revocation flips a second
        // check that surfaces a distinct error string for the dev
        // console.
        const declared =
          entry.plugin.manifest.permissions?.includes('fs.open-directory') ?? false
        if (!declared) {
          this.respondDirectoryOpen(pluginId, msg.seq, {
            ok: false,
            error: 'Plugin did not declare the `fs.open-directory` permission.',
          })
          return
        }
        if (entry.plugin.revokedPermissions.has('fs.open-directory')) {
          this.respondDirectoryOpen(pluginId, msg.seq, {
            ok: false,
            error: 'Permission "fs.open-directory" was revoked.',
          })
          return
        }
        this.emit({
          type: 'directoryOpenRequested',
          pluginId,
          requestSeq: msg.seq,
          ...(msg.extensions ? { extensions: msg.extensions } : {}),
        })
        return
      }

      case 'worker:openFullscreen': {
        // Validate against the manifest. Anything not declared is
        // rejected here, before any singleton coordination, so a
        // plugin that simply made a typo gets a clear error and the
        // host modal never blinks open.
        const declared =
          entry.plugin.manifest.surfaces.fullscreenViews?.some((v) => v.id === msg.viewId) ?? false
        if (!declared) {
          this.respondFullscreenOpen(pluginId, msg.seq, {
            ok: false,
            error: `Fullscreen view "${msg.viewId}" is not declared in the manifest.`,
          })
          return
        }
        this.emit({
          type: 'fullscreenOpenRequested',
          pluginId,
          requestSeq: msg.seq,
          viewId: msg.viewId,
        })
        return
      }

      case 'worker:closeFullscreen':
        this.emit({ type: 'fullscreenCloseRequested', pluginId, viewId: msg.viewId })
        return

      case 'worker:setFullscreenContent':
        this.emit({
          type: 'fullscreenContent',
          pluginId,
          viewId: msg.viewId,
          node: msg.node,
        })
        return

      case 'worker:requestVaultWrite': {
        // v1.2 capability — same two-layer gate PR C uses for
        // vault.read.all: declared in manifest AND not currently
        // revoked at runtime. Distinct error strings so the dev
        // console clarifies; the plugin sees the same Promise
        // rejection either way.
        const declared = entry.plugin.manifest.permissions?.includes('vault.write') ?? false
        if (!declared) {
          this.respondVaultWrite(pluginId, msg.seq, {
            ok: false,
            error: 'Plugin did not declare the `vault.write` permission.',
          })
          return
        }
        if (entry.plugin.revokedPermissions.has('vault.write')) {
          this.respondVaultWrite(pluginId, msg.seq, {
            ok: false,
            error: 'Permission "vault.write" was revoked.',
          })
          return
        }
        this.emit({
          type: 'vaultWriteRequested',
          pluginId,
          requestSeq: msg.seq,
          op: msg.op,
        })
        return
      }
    }
  }

  /** Helper: emit the right error envelope for a vault-read failure.
   *  `'stream'` mode uses the streaming envelope so the worker's
   *  AsyncIterable terminates with the error instead of dangling. */
  private respondVaultReadError(
    pluginId: string,
    requestSeq: number,
    mode: 'all' | 'one' | 'stream',
    error: string,
  ): void {
    if (mode === 'stream') {
      this.respondVaultStreamChunk(pluginId, requestSeq, {
        chunkIndex: 0,
        notes: [],
        error,
      })
      return
    }
    this.respondVaultRead(pluginId, requestSeq, { ok: false, error })
  }

  /** Surface adapter / singleton wires the native save dialog here.
   *  Reports the outcome back to the worker via host:fileSaveResult. */
  respondFileSave(
    pluginId: string,
    requestSeq: number,
    result: { ok: true } | { ok: false; error: string },
  ): void {
    this.send(pluginId, {
      type: 'host:fileSaveResult',
      seq: ++this.seqCounter,
      requestSeq,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
    })
  }

  /** Singleton adapter wires the live note-store snapshot here.
   *  Modes `'all'` / `'one'` come back on this envelope; `'stream'`
   *  uses `respondVaultStreamChunk` instead. Exactly one of `notes` /
   *  `note` is set on success. */
  respondVaultRead(
    pluginId: string,
    requestSeq: number,
    result:
      | { ok: true; notes: ReadonlyArray<NoteWithBodyWire>; note?: undefined }
      | { ok: true; note: NoteWithBodyWire | null; notes?: undefined }
      | { ok: false; error: string },
  ): void {
    this.send(pluginId, {
      type: 'host:vaultReadResult',
      seq: ++this.seqCounter,
      requestSeq,
      ok: result.ok,
      ...(result.ok && result.notes !== undefined ? { notes: result.notes } : {}),
      ...(result.ok && result.note !== undefined ? { note: result.note } : {}),
      ...(!result.ok ? { error: result.error } : {}),
    })
  }

  /** Emit one chunk of a vault-stream response. The adapter calls this
   *  once per page; a chunk with `notes: []` (no error) terminates the
   *  iterator successfully. An `error` on any chunk terminates with a
   *  rejection. */
  respondVaultStreamChunk(
    pluginId: string,
    requestSeq: number,
    chunk: {
      chunkIndex: number
      notes: ReadonlyArray<NoteWithBodyWire>
      error?: string
    },
  ): void {
    this.send(pluginId, {
      type: 'host:vaultStreamChunk',
      seq: ++this.seqCounter,
      requestSeq,
      chunkIndex: chunk.chunkIndex,
      notes: chunk.notes,
      ...(chunk.error ? { error: chunk.error } : {}),
    })
  }

  /** Surface adapter wires the fullscreen mount here. Reports
   *  whether the modal mounted; on `ok: true` the host should also
   *  emit `notifyFullscreenOpened` so the plugin's
   *  `onFullscreenMount` runs and the plugin can populate content. */
  respondFullscreenOpen(
    pluginId: string,
    requestSeq: number,
    result: { ok: true } | { ok: false; error: string },
  ): void {
    this.send(pluginId, {
      type: 'host:fullscreenOpenResult',
      seq: ++this.seqCounter,
      requestSeq,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
    })
  }

  /** Notify the worker that the fullscreen modal is now mounted.
   *  Fire-and-forget — the worker uses this to run
   *  `onFullscreenMount`. Separate from `respondFullscreenOpen` so
   *  the open call's Promise can resolve before the mount handler
   *  starts emitting content updates. */
  notifyFullscreenOpened(pluginId: string, viewId: string): void {
    this.send(pluginId, {
      type: 'host:fullscreenOpened',
      seq: ++this.seqCounter,
      viewId,
    })
  }

  /** Notify the worker that the fullscreen modal is now unmounted
   *  (X click, Esc, page unload, or explicit closeFullscreen). The
   *  worker runs `onFullscreenUnmount`. */
  notifyFullscreenClosed(pluginId: string, viewId: string): void {
    this.send(pluginId, {
      type: 'host:fullscreenClosed',
      seq: ++this.seqCounter,
      viewId,
    })
  }

  /** Surface adapter / singleton wires the vault write outcome back to
   *  the worker. Successful `create` carries the new note id plus the
   *  conflict-resolution outcome. Other ops omit `id` and
   *  `conflictResolved`. v1.2 PR D capability. */
  respondVaultWrite(
    pluginId: string,
    requestSeq: number,
    result:
      | { ok: true; id: string; conflictResolved: 'none' | 'suffix' }
      | { ok: true }
      | { ok: false; error: string },
  ): void {
    this.send(pluginId, {
      type: 'host:vaultWriteResult',
      seq: ++this.seqCounter,
      requestSeq,
      ok: result.ok,
      ...(result.ok && 'id' in result
        ? { id: result.id, conflictResolved: result.conflictResolved }
        : {}),
      ...(!result.ok ? { error: result.error } : {}),
    })
  }

  /** Surface adapter / singleton wires the native file picker here. */
  respondFileOpen(
    pluginId: string,
    requestSeq: number,
    result:
      | { ok: true; bytesBase64: string; filename: string }
      | { ok: true; bytesBase64?: undefined; filename?: undefined }
      | { ok: false; error: string },
  ): void {
    this.send(pluginId, {
      type: 'host:fileOpenResult',
      seq: ++this.seqCounter,
      requestSeq,
      ok: result.ok,
      ...(result.ok && 'bytesBase64' in result && result.bytesBase64 !== undefined
        ? { bytesBase64: result.bytesBase64, filename: result.filename ?? 'file' }
        : {}),
      ...(!result.ok ? { error: result.error } : {}),
    })
  }

  /** Surface adapter / singleton wires the native directory picker
   *  here. Blobs ride through `postMessage` via structured clone — no
   *  base64 round-trip, so a 500 MB folder pick stays cheap on the
   *  main thread. v1.2 capability — see plugins-v1.2-plan.md 4.3. */
  respondDirectoryOpen(
    pluginId: string,
    requestSeq: number,
    result:
      | { ok: true; entries: ReadonlyArray<{ name: string; path: string; blob: Blob }> }
      | { ok: true; entries?: undefined }
      | { ok: false; error: string },
  ): void {
    this.send(pluginId, {
      type: 'host:directoryOpenResult',
      seq: ++this.seqCounter,
      requestSeq,
      ok: result.ok,
      ...(result.ok && 'entries' in result && result.entries !== undefined
        ? { entries: result.entries }
        : {}),
      ...(!result.ok ? { error: result.error } : {}),
    })
  }

  private emit(event: PluginHostEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Listener errors are swallowed; one buggy listener shouldn't
        // break the others.
      }
    }
  }
}

function defaultCreateWorker(): MinimalWorker {
  // The bundled-workerEntry URL is wired in `pluginHostSingleton.ts`
  // via `opts.createWorker`. If we land here it means PluginHost was
  // constructed without a createWorker override AND we are running
  // in the browser — surface a clear message instead of letting the
  // Worker call below throw cryptically.
  throw new Error(
    'PluginHost.createWorker must be provided. Construct the host through ' +
      'getPluginHost() so the workerEntry URL is wired automatically.',
  )
}

function nowMs(): number {
  // Date.now is unavailable in some sandboxed environments; performance.now
  // is monotonic and present everywhere we care about. The Jest jsdom
  // env provides both.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function estimateSize(value: unknown): number {
  try {
    return JSON.stringify(value ?? null).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function hasSub(entry: WorkerEntry, event: VaultEventName): boolean {
  for (const sub of entry.vaultSubs.values()) {
    if (sub.event === event) return true
  }
  return false
}
