// Runs INSIDE the per-plugin Web Worker. Hosts the plugin module,
// translates host messages into PluginCtx method calls, and emits
// outgoing messages on behalf of the plugin.
//
// CRUCIAL: this file has NO access to `document`, `localStorage`, or
// any noteser store. It can only `self.postMessage` and receive
// messages via `self.onmessage`. If you find yourself reaching for a
// global other than `self`, stop and think about whether that thing
// belongs in `ctx` instead.
//
// The worker is bootstrapped by main-thread code that constructs a
// Blob URL containing this file's bundled output. Boot sequence:
//   1. Host posts `host:boot` with the plugin source code as a string
//   2. Worker evaluates the source as an ES module (via Blob URL +
//      dynamic import) and reads the default export
//   3. Worker validates the manifest a second time defensively
//   4. Worker stashes the handlers + manifest in module-scope and
//      replies `worker:ready` with the validated manifest
//   5. Host begins sending events; worker dispatches them to handlers

import { validateManifest, type PluginManifest } from './manifest'
import {
  MAX_VAULT_SUBSCRIPTIONS_PER_EVENT,
  type HostToWorker,
  type WorkerToHost,
  type HostBootMessage,
  type NoteWithBodyWire,
} from './protocol'
import type {
  DirectoryEntries,
  NoteWithBody,
  PluginCtx,
  PluginDefinition,
  Unsubscribe,
} from './sdk'

interface PluginState {
  manifest: PluginManifest
  def: PluginDefinition
  /** Per-plugin namespaced settings store, populated via setSetting. */
  settings: Map<string, unknown>
  /** Latest active-note snapshot, refreshed by activeNoteChanged events. */
  activeNote: { id: string; title: string; content: string } | null
  /** Notes list (titles + paths only) refreshed by activeNoteChanged. */
  notes: ReadonlyArray<{ id: string; title: string; folderPath: string }>
}

let state: PluginState | null = null

/** Pending file-I/O requests waiting for the host's reply. Keyed by
 *  the request seq the worker emitted; resolved when the matching
 *  host:fileSaveResult / host:fileOpenResult arrives. */
interface PendingFileSave {
  kind: 'save'
  resolve: () => void
  reject: (err: Error) => void
}
interface PendingFileOpen {
  kind: 'open'
  resolve: (v: { bytes: Uint8Array; filename: string } | null) => void
  reject: (err: Error) => void
}
interface PendingVaultReadAll {
  kind: 'vault.all'
  resolve: (notes: ReadonlyArray<NoteWithBody>) => void
  reject: (err: Error) => void
}
interface PendingVaultReadOne {
  kind: 'vault.one'
  resolve: (note: NoteWithBody | null) => void
  reject: (err: Error) => void
}
interface PendingVaultReadStream {
  kind: 'vault.stream'
  /** Emits one chunk per host:vaultStreamChunk arrival, or completes
   *  with null when the host signals end-of-stream / error. */
  push: (chunk: ReadonlyArray<NoteWithBody> | null, error: string | null) => void
}
interface PendingDirectoryOpen {
  kind: 'openDirectory'
  resolve: (v: DirectoryEntries | null) => void
  reject: (err: Error) => void
}
interface PendingFullscreenOpen {
  kind: 'fullscreen-open'
  resolve: () => void
  reject: (err: Error) => void
}
const pending = new Map<
  number,
  | PendingFileSave
  | PendingFileOpen
  | PendingVaultReadAll
  | PendingVaultReadOne
  | PendingVaultReadStream
  | PendingDirectoryOpen
  | PendingFullscreenOpen
>()

let nextRequestSeq = 0
function allocRequestSeq(): number {
  return ++nextRequestSeq
}

// ─── vault.events subscriptions ─────────────────────────────────────────
//
// One handler table per event type. The worker mints opaque
// subscriptionIds (`vsub-<n>`) the host pairs against incoming
// host:vaultChanged / host:noteSaved / host:activeNoteIdChanged
// envelopes.
//
// On plugin teardown (worker termination) the host drops every
// subscription on its side, so this in-worker map never has to be
// drained — but plugins are still encouraged to call the returned
// unsubscribe so a long-lived plugin does not accumulate handlers
// across panel mounts.

type VaultEventName = 'vaultChanged' | 'noteSaved' | 'activeNoteIdChanged'
type AnyVaultHandler =
  | (() => void)
  | ((noteId: string) => void)
  | ((noteId: string | null) => void)

interface VaultSubEntry {
  event: VaultEventName
  handler: AnyVaultHandler
}

const vaultSubs = new Map<string, VaultSubEntry>()
let nextSubSeq = 0

function countSubsForEvent(event: VaultEventName): number {
  let n = 0
  for (const v of vaultSubs.values()) if (v.event === event) n++
  return n
}

function subscribeVault(event: VaultEventName, handler: AnyVaultHandler): Unsubscribe {
  if (countSubsForEvent(event) >= MAX_VAULT_SUBSCRIPTIONS_PER_EVENT) {
    throw new Error(
      `Too many ${event} subscriptions (max ${MAX_VAULT_SUBSCRIPTIONS_PER_EVENT} per plugin).`,
    )
  }
  const subscriptionId = `vsub-${++nextSubSeq}`
  vaultSubs.set(subscriptionId, { event, handler })
  emit({
    type: 'worker:subscribeVault',
    seq: allocRequestSeq(),
    event,
    subscriptionId,
  })
  return () => {
    if (!vaultSubs.has(subscriptionId)) return
    vaultSubs.delete(subscriptionId)
    emit({
      type: 'worker:unsubscribeVault',
      seq: allocRequestSeq(),
      subscriptionId,
    })
  }
}

function dispatchVault(subscriptionId: string, payload: string | null | undefined): void {
  const entry = vaultSubs.get(subscriptionId)
  if (!entry) return
  try {
    if (entry.event === 'vaultChanged') {
      ;(entry.handler as () => void)()
    } else if (entry.event === 'noteSaved') {
      ;(entry.handler as (noteId: string) => void)(payload as string)
    } else {
      ;(entry.handler as (noteId: string | null) => void)(payload ?? null)
    }
  } catch (err) {
    emit({
      type: 'worker:error',
      seq: 0,
      message: `vault.events handler threw: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

self.onmessage = async (event: MessageEvent<HostToWorker>) => {
  const msg = event.data
  try {
    switch (msg.type) {
      case 'host:boot':
        await handleBoot(msg)
        return

      case 'host:invokeCommand':
        await handleInvokeCommand(msg.seq, msg.commandId)
        return

      case 'host:mountPanel':
        await handleMountPanel(msg.seq, msg.panelId)
        return

      case 'host:unmountPanel':
        await handleUnmountPanel(msg.seq, msg.panelId)
        return

      case 'host:activeNoteChanged':
        await handleActiveNoteChanged(msg.seq, msg.note)
        return

      case 'host:renderCodeBlock':
        await handleRenderCodeBlock(msg.seq, msg.language, msg.source, msg.blockId)
        return

      case 'host:fileSaveResult': {
        const p = pending.get(msg.requestSeq)
        if (p && p.kind === 'save') {
          pending.delete(msg.requestSeq)
          if (msg.ok) p.resolve()
          else p.reject(new Error(msg.error ?? 'File save failed.'))
        }
        return
      }

      case 'host:fileOpenResult': {
        const p = pending.get(msg.requestSeq)
        if (p && p.kind === 'open') {
          pending.delete(msg.requestSeq)
          if (msg.ok) {
            if (msg.bytesBase64 === undefined || msg.filename === undefined) {
              p.resolve(null)
            } else {
              p.resolve({ bytes: base64ToBytes(msg.bytesBase64), filename: msg.filename })
            }
          } else {
            p.reject(new Error(msg.error ?? 'File open failed.'))
          }
        }
        return
      }

      case 'host:vaultReadResult': {
        const p = pending.get(msg.requestSeq)
        if (!p) return
        if (p.kind === 'vault.all') {
          pending.delete(msg.requestSeq)
          if (!msg.ok) {
            p.reject(new Error(msg.error ?? 'vault.read.getAllNotes failed.'))
            return
          }
          p.resolve((msg.notes ?? []) as ReadonlyArray<NoteWithBody>)
          return
        }
        if (p.kind === 'vault.one') {
          pending.delete(msg.requestSeq)
          if (!msg.ok) {
            p.reject(new Error(msg.error ?? 'vault.read.getNote failed.'))
            return
          }
          // `note` may be undefined on the wire when the host sent the
          // null variant (host normalises null → omitted spread); the
          // SDK contract is null-when-not-found.
          p.resolve(msg.note === undefined ? null : (msg.note as NoteWithBody | null))
          return
        }
        // Wrong response kind for the pending request shape — emit a
        // worker:error so the dev sees the protocol mismatch instead
        // of a silently hung Promise.
        emit({
          type: 'worker:error',
          seq: 0,
          message: `vaultReadResult arrived for a non-read pending request (kind=${p.kind}).`,
        })
        return
      }

      case 'host:vaultStreamChunk': {
        const p = pending.get(msg.requestSeq)
        if (!p || p.kind !== 'vault.stream') return
        if (msg.error) {
          pending.delete(msg.requestSeq)
          p.push(null, msg.error)
          return
        }
        if (msg.notes.length === 0) {
          // End-of-stream marker.
          pending.delete(msg.requestSeq)
          p.push(null, null)
          return
        }
        p.push(msg.notes as ReadonlyArray<NoteWithBody>, null)
        return
      }

      case 'host:vaultChanged':
        dispatchVault(msg.subscriptionId, undefined)
        return

      case 'host:noteSaved':
        dispatchVault(msg.subscriptionId, msg.noteId)
        return

      case 'host:activeNoteIdChanged':
        dispatchVault(msg.subscriptionId, msg.noteId)
        return

      case 'host:directoryOpenResult': {
        const p = pending.get(msg.requestSeq)
        if (p && p.kind === 'openDirectory') {
          pending.delete(msg.requestSeq)
          if (msg.ok) {
            // No entries → user cancelled the picker. Distinct from a
            // permission rejection (ok=false) so the plugin can branch
            // on `null` vs catching an error.
            if (msg.entries === undefined) {
              p.resolve(null)
            } else {
              p.resolve(msg.entries as DirectoryEntries)
            }
          } else {
            p.reject(new Error(msg.error ?? 'Directory open failed.'))
          }
        }
        return
      }

      case 'host:fullscreenOpenResult': {
        const p = pending.get(msg.requestSeq)
        if (p && p.kind === 'fullscreen-open') {
          pending.delete(msg.requestSeq)
          if (msg.ok) p.resolve()
          else p.reject(new Error(msg.error ?? 'Could not open fullscreen view.'))
        }
        return
      }

      case 'host:fullscreenOpened':
        await handleFullscreenOpened(msg.seq, msg.viewId)
        return

      case 'host:fullscreenClosed':
        await handleFullscreenClosed(msg.seq, msg.viewId)
        return

      default:
        // Exhaustiveness — TypeScript will catch missed cases at build,
        // this branch is the runtime tripwire if the protocol changes
        // without updating the worker.
        emit({
          type: 'worker:error',
          seq: 0,
          message: `Unknown host message type: ${(msg as { type: string }).type}`,
        })
    }
  } catch (err) {
    emit({
      type: 'worker:error',
      seq: msg.seq,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  // btoa is available in Workers.
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function handleBoot(msg: HostBootMessage): Promise<void> {
  if (state !== null) {
    emit({ type: 'worker:bootError', seq: msg.seq, message: 'Plugin already booted.' })
    return
  }

  // Eval the plugin source via Blob URL + dynamic import. This gives
  // us a real ES module evaluation rather than `new Function`, so
  // `import` / `export default` work as expected. The Blob URL is
  // revoked immediately after the import resolves.
  const blob = new Blob([msg.source], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  let mod: { default?: unknown }
  try {
    mod = (await import(/* webpackIgnore: true */ blobUrl)) as { default?: unknown }
  } finally {
    URL.revokeObjectURL(blobUrl)
  }

  if (!mod || typeof mod.default !== 'object' || mod.default === null) {
    emit({
      type: 'worker:bootError',
      seq: msg.seq,
      message: 'Plugin module must export a default object from definePlugin().',
    })
    return
  }

  const def = mod.default as PluginDefinition
  const validation = validateManifest(def)
  if (!validation.ok || !validation.manifest) {
    emit({
      type: 'worker:bootError',
      seq: msg.seq,
      message: `Manifest invalid: ${validation.errors.join('; ')}`,
    })
    return
  }

  if (validation.manifest.id !== msg.pluginId) {
    emit({
      type: 'worker:bootError',
      seq: msg.seq,
      message: `Manifest id "${validation.manifest.id}" does not match expected "${msg.pluginId}".`,
    })
    return
  }

  state = {
    manifest: validation.manifest,
    def,
    settings: new Map(),
    activeNote: null,
    notes: [],
  }

  // onActivate runs before the host considers the plugin booted; any
  // exception here surfaces as bootError so the host can show it.
  try {
    if (typeof def.onActivate === 'function') {
      await def.onActivate(buildCtx(msg.seq))
    }
  } catch (err) {
    state = null
    emit({
      type: 'worker:bootError',
      seq: msg.seq,
      message: `onActivate threw: ${err instanceof Error ? err.message : String(err)}`,
    })
    return
  }

  emit({ type: 'worker:ready', seq: msg.seq, manifest: validation.manifest })
}

async function handleInvokeCommand(seq: number, commandId: string): Promise<void> {
  if (state === null) {
    emit({ type: 'worker:commandHandled', seq, commandId, error: 'Plugin not booted.' })
    return
  }
  try {
    if (typeof state.def.onCommand === 'function') {
      await state.def.onCommand(commandId, buildCtx(seq))
    }
    emit({ type: 'worker:commandHandled', seq, commandId })
  } catch (err) {
    emit({
      type: 'worker:commandHandled',
      seq,
      commandId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function handleMountPanel(seq: number, panelId: string): Promise<void> {
  if (state === null) return
  if (typeof state.def.onPanelMount === 'function') {
    await state.def.onPanelMount(panelId, buildCtx(seq))
  }
}

async function handleUnmountPanel(seq: number, panelId: string): Promise<void> {
  if (state === null) return
  if (typeof state.def.onPanelUnmount === 'function') {
    await state.def.onPanelUnmount(panelId, buildCtx(seq))
  }
}

async function handleActiveNoteChanged(
  seq: number,
  note: { id: string; title: string; folderPath: string; content: string } | null,
): Promise<void> {
  if (state === null) return
  state.activeNote = note ? { id: note.id, title: note.title, content: note.content } : null
  if (typeof state.def.onActiveNoteChange === 'function') {
    await state.def.onActiveNoteChange(state.activeNote, buildCtx(seq))
  }
}

async function handleRenderCodeBlock(
  seq: number,
  language: string,
  source: string,
  blockId: string,
): Promise<void> {
  if (state === null) return
  if (typeof state.def.onRenderCodeBlock === 'function') {
    await state.def.onRenderCodeBlock({ language, source, blockId }, buildCtx(seq))
  }
}

async function handleFullscreenOpened(seq: number, viewId: string): Promise<void> {
  if (state === null) return
  if (typeof state.def.onFullscreenMount === 'function') {
    await state.def.onFullscreenMount(viewId, buildCtx(seq))
  }
}

async function handleFullscreenClosed(seq: number, viewId: string): Promise<void> {
  if (state === null) return
  if (typeof state.def.onFullscreenUnmount === 'function') {
    await state.def.onFullscreenUnmount(viewId, buildCtx(seq))
  }
}

function buildCtx(parentSeq: number): PluginCtx {
  if (state === null) throw new Error('buildCtx called before boot')
  const s = state
  return {
    get activeNote() {
      return s.activeNote
    },
    get notes() {
      return s.notes
    },
    setPanelContent(panelId, node) {
      emit({ type: 'worker:setPanelContent', seq: parentSeq, panelId, node })
    },
    renderCodeBlock(blockId, node) {
      emit({ type: 'worker:renderResult', seq: parentSeq, blockId, node })
    },
    insertText(text) {
      emit({ type: 'worker:insertText', seq: parentSeq, text })
    },
    notify(message) {
      emit({ type: 'worker:notify', seq: parentSeq, message })
    },
    getSetting<T = unknown>(key: string): T | undefined {
      return s.settings.get(key) as T | undefined
    },
    setSetting<T = unknown>(key: string, value: T): void {
      s.settings.set(key, value)
    },
    requestFileSave({ suggestedName, mimeType, bytes }) {
      const requestSeq = allocRequestSeq()
      const promise = new Promise<void>((resolve, reject) => {
        pending.set(requestSeq, { kind: 'save', resolve, reject })
      })
      emit({
        type: 'worker:requestFileSave',
        seq: requestSeq,
        suggestedName,
        mimeType,
        bytesBase64: bytesToBase64(bytes),
      })
      return promise
    },
    requestFileOpen(opts) {
      const requestSeq = allocRequestSeq()
      const promise = new Promise<{ bytes: Uint8Array; filename: string } | null>(
        (resolve, reject) => {
          pending.set(requestSeq, { kind: 'open', resolve, reject })
        },
      )
      emit({
        type: 'worker:requestFileOpen',
        seq: requestSeq,
        ...(opts?.accept ? { accept: opts.accept } : {}),
      })
      return promise
    },
    vault: {
      read: {
        getAllNotes() {
          const requestSeq = allocRequestSeq()
          const promise = new Promise<ReadonlyArray<NoteWithBody>>((resolve, reject) => {
            pending.set(requestSeq, { kind: 'vault.all', resolve, reject })
          })
          emit({
            type: 'worker:requestVaultRead',
            seq: requestSeq,
            mode: 'all',
          })
          return promise
        },
        getNote(id: string) {
          const requestSeq = allocRequestSeq()
          const promise = new Promise<NoteWithBody | null>((resolve, reject) => {
            pending.set(requestSeq, { kind: 'vault.one', resolve, reject })
          })
          emit({
            type: 'worker:requestVaultRead',
            seq: requestSeq,
            mode: 'one',
            noteId: id,
          })
          return promise
        },
        stream(opts?: { chunkSize?: number }) {
          return makeVaultStream(opts?.chunkSize)
        },
      },
      events: {
        onVaultChange(handler: () => void): Unsubscribe {
          return subscribeVault('vaultChanged', handler)
        },
        onNoteSaved(handler: (noteId: string) => void): Unsubscribe {
          return subscribeVault('noteSaved', handler)
        },
        onActiveNoteChange(handler: (noteId: string | null) => void): Unsubscribe {
          return subscribeVault('activeNoteIdChanged', handler)
        },
      },
    },
    fs: {
      openDirectory(opts) {
        const requestSeq = allocRequestSeq()
        const promise = new Promise<DirectoryEntries | null>((resolve, reject) => {
          pending.set(requestSeq, { kind: 'openDirectory', resolve, reject })
        })
        emit({
          type: 'worker:requestDirectoryOpen',
          seq: requestSeq,
          ...(opts?.extensions ? { extensions: opts.extensions } : {}),
        })
        return promise
      },
    },
    openFullscreen(viewId: string) {
      const requestSeq = allocRequestSeq()
      const promise = new Promise<void>((resolve, reject) => {
        pending.set(requestSeq, { kind: 'fullscreen-open', resolve, reject })
      })
      emit({ type: 'worker:openFullscreen', seq: requestSeq, viewId })
      return promise
    },
    closeFullscreen(viewId: string) {
      emit({ type: 'worker:closeFullscreen', seq: allocRequestSeq(), viewId })
    },
    setFullscreenContent(viewId: string, node: unknown) {
      emit({
        type: 'worker:setFullscreenContent',
        seq: parentSeq,
        viewId,
        node,
      })
    },
  }
}

/**
 * Build the AsyncIterable that backs `ctx.vault.read.stream()`.
 *
 * Implementation note: chunks arrive on a fan-in queue keyed by the
 * request seq. The iterator's `next()` pulls from that queue, awaiting
 * a host:vaultStreamChunk when empty. End-of-stream is signalled by
 * `push(null, null)`; an error by `push(null, error)`. We DO NOT post
 * a new envelope per chunk — the host paginates on its own cadence.
 */
function makeVaultStream(chunkSize: number | undefined): AsyncIterable<ReadonlyArray<NoteWithBody>> {
  const requestSeq = allocRequestSeq()
  const buffer: ReadonlyArray<NoteWithBody>[] = []
  let done = false
  let error: string | null = null
  // Pending consumer waker. When `next()` is called with an empty
  // buffer we park here; the chunk handler resolves us.
  let wake: (() => void) | null = null

  pending.set(requestSeq, {
    kind: 'vault.stream',
    push(chunk, err) {
      if (err) {
        error = err
        done = true
      } else if (chunk === null) {
        done = true
      } else {
        buffer.push(chunk)
      }
      const w = wake
      wake = null
      w?.()
    },
  })

  emit({
    type: 'worker:requestVaultRead',
    seq: requestSeq,
    mode: 'stream',
    ...(typeof chunkSize === 'number' ? { chunkSize } : {}),
  })

  return {
    [Symbol.asyncIterator](): AsyncIterator<ReadonlyArray<NoteWithBody>> {
      return {
        async next(): Promise<IteratorResult<ReadonlyArray<NoteWithBody>>> {
          while (buffer.length === 0 && !done) {
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
          if (buffer.length > 0) {
            return { value: buffer.shift() as ReadonlyArray<NoteWithBody>, done: false }
          }
          if (error !== null) throw new Error(error)
          return { value: undefined as unknown as ReadonlyArray<NoteWithBody>, done: true }
        },
        async return(): Promise<IteratorResult<ReadonlyArray<NoteWithBody>>> {
          // Plugin abandoned the iterator (e.g. `break` out of for-await).
          // Mark complete; the host will still finish emitting chunks
          // but the plugin no longer cares.
          done = true
          pending.delete(requestSeq)
          return { value: undefined as unknown as ReadonlyArray<NoteWithBody>, done: true }
        },
      }
    },
  }
}

// Mark `NoteWithBodyWire` referenced so the import is not stripped by
// TS' isolatedModules pass — the worker treats wire and SDK shapes as
// structurally identical, but we still want the type-level link.
type _NoteWithBodyWireAlias = NoteWithBodyWire

function emit(msg: WorkerToHost): void {
  ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(msg)
}
