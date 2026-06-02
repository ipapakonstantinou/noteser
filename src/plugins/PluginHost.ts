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
  type HostToWorker,
  type WorkerToHost,
} from './protocol'
import type { PluginManifest } from './manifest'

export interface InstalledPlugin {
  manifest: PluginManifest
  /** Last time the worker emitted a message — used by the rate limiter. */
  lastMessageWindowStart: number
  messagesInWindow: number
  /** undefined when the plugin is loaded but not yet ready (boot in
   *  flight); set once worker:ready arrives. */
  ready: boolean
}

export interface PluginHostOptions {
  /** Override Worker constructor for testing — a fake Worker that
   *  echoes messages back synchronously. Production uses the real
   *  global Worker.
   *
   *  The factory receives the worker entry source as a string and
   *  must return something that conforms to the Worker interface
   *  (postMessage + onmessage + terminate). */
  createWorker?: (entrySource: string) => MinimalWorker
  /** Override `URL.createObjectURL` / revokeObjectURL pair for tests
   *  where Blob URLs are not available. */
  blobUrlFor?: (source: string) => string
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
  | { type: 'rateLimited'; pluginId: string }

interface WorkerEntry {
  plugin: InstalledPlugin
  worker: MinimalWorker
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
   * `entrySource` is the bundled output of `src/plugins/workerEntry.ts`,
   * NOT the plugin source. The plugin source is shipped as the
   * `host:boot` payload. We expect the caller (PluginInstaller, week 3)
   * to fetch both.
   */
  async load(args: {
    pluginId: string
    pluginSource: string
    entrySource: string
    timeoutMs?: number
  }): Promise<PluginManifest> {
    const { pluginId, pluginSource, entrySource } = args
    const timeoutMs = args.timeoutMs ?? 5000

    if (this.workers.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" already loaded.`)
    }

    const worker = (this.opts.createWorker ?? defaultCreateWorker)(entrySource)
    const plugin: InstalledPlugin = {
      manifest: { id: pluginId, name: pluginId, version: '0.0.0', surfaces: {} },
      lastMessageWindowStart: nowMs(),
      messagesInWindow: 0,
      ready: false,
    }
    const entry: WorkerEntry = { plugin, worker }
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

  /** Terminate a plugin's worker and forget it. */
  unload(pluginId: string): void {
    const entry = this.workers.get(pluginId)
    if (!entry) return
    try {
      entry.worker.terminate()
    } catch {
      // Some test fakes do not implement terminate; ignore.
    }
    this.workers.delete(pluginId)
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

  /** Editor switched to a new note (or no note). */
  activeNoteChanged(
    pluginId: string,
    note: { id: string; title: string; folderPath: string } | null,
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
    }
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

function defaultCreateWorker(entrySource: string): MinimalWorker {
  const blob = new Blob([entrySource], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  const worker = new Worker(url, { type: 'module' })
  // Revoke the URL once the worker boots — the browser keeps the
  // Blob alive for the worker's lifetime even after revoke.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return worker as MinimalWorker
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
