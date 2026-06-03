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
import type {
  HostToWorker,
  WorkerToHost,
  HostBootMessage,
} from './protocol'
import type { PluginCtx, PluginDefinition } from './sdk'

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
  }
}

function emit(msg: WorkerToHost): void {
  ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(msg)
}
