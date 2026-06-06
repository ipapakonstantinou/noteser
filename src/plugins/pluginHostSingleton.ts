// Lazy singleton + side-effect glue between PluginHost (pure) and
// the rest of the noteser app (Zustand stores, toast system, editor).
//
// The PluginHost class is intentionally side-effect-free so it tests
// cleanly. This module wires the host into the live app:
//
//   ready          → usePluginStore.addReady(manifest)
//   bootError      → useToastStore.addToast({ kind: 'error', ... })
//                  + usePluginStore.appendError
//   notify         → useToastStore.addToast({ kind: 'info', ... })
//   workerError    → usePluginStore.appendError
//   rateLimited    → useToastStore.addToast({ kind: 'error', ... })
//
// `getPluginHost()` is the only export. First call constructs the host
// and wires the listener; later calls return the same instance. SSR
// safety: the function returns null on the server, since Workers do
// not exist there.

import { PluginHost, type MinimalWorker } from './PluginHost'
import { MAX_DIRECTORY_ENTRIES } from './protocol'
import {
  buildExtensionMatcher,
  walkDirectoryHandle,
  type FileSystemDirectoryHandleLike,
} from './directoryPickerHelpers'
import { usePluginStore } from '@/stores/pluginStore'
import { usePluginInstallStore, type InstalledPluginRecord } from '@/stores/pluginInstallStore'
import { useToastStore } from '@/stores/toastStore'
import { useNoteStore } from '@/stores/noteStore'
import { useFolderStore } from '@/stores/folderStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { fetchPluginFromUrl, fetchPluginFromManifest, sha256Hex } from './installer'
import type { VaultManifestCandidate } from './vaultScan'
import { bootMark, bootMeasure, yieldToMain } from '@/utils/bootTrace'
import {
  snapshotAllNotes,
  snapshotNoteById,
  streamVaultSnapshot,
  projectPayloadSize,
  MAX_GET_ALL_BYTES,
} from './vaultSnapshot'

let instance: PluginHost | null = null

/** Get the app-wide PluginHost. Returns null during SSR — callers
 *  must guard for that. */
export function getPluginHost(): PluginHost | null {
  if (typeof window === 'undefined') return null
  if (instance === null) {
    instance = new PluginHost({
      createWorker: spawnPluginWorker,
      isPermissionRevoked: (pluginId, permission) => {
        const rec = usePluginInstallStore.getState().records[pluginId]
        return rec?.revokedPermissions?.includes(permission) ?? false
      },
    })
    wireListener(instance)
    wireActiveNoteTracker(instance)
    wireVaultEvents(instance)
  }
  return instance
}

/**
 * Spawn the per-plugin Web Worker pointing at the bundled
 * `workerEntry.ts` module. Webpack and Next.js recognise the
 * `new URL('./workerEntry', import.meta.url)` pattern and bundle
 * the file as a separate chunk, returning a same-origin URL that
 * the Worker constructor accepts.
 *
 * One Worker per plugin — the host calls this each time a plugin
 * is `load()`-ed.
 */
function spawnPluginWorker(): MinimalWorker {
  return new Worker(new URL('./workerEntry', import.meta.url), {
    type: 'module',
  }) as unknown as MinimalWorker
}

/** Reset for tests only. Terminates every plugin and clears the
 *  singleton. */
export function resetPluginHostForTests(): void {
  if (instance === null) return
  for (const p of instance.listReady()) instance.unload(p.manifest.id)
  instance = null
  usePluginStore.getState().clear()
}

/**
 * v1.1 install flow — two-step:
 *
 *   1. fetchPluginForInstall(url) → returns a "candidate" record the
 *      caller can show in a confirmation modal (manifest summary +
 *      requested permissions). NO side effects.
 *   2. confirmAndInstallPlugin(candidate) → persists + boots.
 *
 * For backwards compat the original installPluginFromUrl() still
 * exists as a one-shot helper (skips the modal); test code uses it.
 */
export async function fetchPluginForInstall(
  manifestUrl: string,
): Promise<InstalledPluginRecord> {
  const fetched = await fetchPluginFromUrl(manifestUrl)
  return {
    manifest: fetched.manifest,
    mainSource: fetched.mainSource,
    hash: fetched.hash,
    sourceUrl: fetched.sourceUrl,
    addedAt: Date.now(),
    enabled: true,
  }
}

/**
 * Vault-scan equivalent of fetchPluginForInstall. Takes a candidate
 * from scanVaultForManifests (manifest already parsed + validated)
 * and fetches the bundle, returning a record the existing confirm
 * modal accepts unchanged.
 */
export async function fetchPluginForInstallFromVault(
  candidate: VaultManifestCandidate,
): Promise<InstalledPluginRecord> {
  const fetched = await fetchPluginFromManifest({
    manifest: candidate.manifest,
    mainUrl: candidate.mainUrl,
    sourceLabel: `vault: ${candidate.pathInVault}`,
  })
  return {
    manifest: fetched.manifest,
    mainSource: fetched.mainSource,
    hash: fetched.hash,
    sourceUrl: fetched.sourceUrl,
    addedAt: Date.now(),
    enabled: true,
  }
}

export async function confirmAndInstallPlugin(record: InstalledPluginRecord): Promise<void> {
  const host = getPluginHost()
  if (host === null) throw new Error('Plugins are unavailable during server-side rendering.')
  usePluginInstallStore.getState().install(record)
  if (host.isLoaded(record.manifest.id)) host.unload(record.manifest.id)
  await host.load({
    pluginId: record.manifest.id,
    pluginSource: record.mainSource,
  })
  // Apply any persisted revocations from previous sessions. Without
  // this a user who revokes a capability, restarts the app, and lets
  // the bootstrap reload the plugin would silently regain the
  // capability on next call.
  for (const perm of record.revokedPermissions ?? []) {
    host.revokePermission(record.manifest.id, perm)
  }
}

/**
 * One-shot install (legacy / programmatic use). Skips the
 * confirmation modal entirely — UI callers should use
 * fetchPluginForInstall + confirmAndInstallPlugin instead so the
 * user gets a chance to see what they are installing.
 */
export async function installPluginFromUrl(manifestUrl: string): Promise<void> {
  const candidate = await fetchPluginForInstall(manifestUrl)
  await confirmAndInstallPlugin(candidate)
}

/**
 * Boot every enabled persisted plugin. Run once at app startup,
 * after the install store hydrates from IndexedDB.
 *
 * Hash mismatches surface as a toast and skip the load — the
 * stored bundle was somehow corrupted or tampered with, and we
 * refuse to run a binary that does not match what we wrote.
 */
export async function bootstrapInstalledPlugins(): Promise<void> {
  const host = getPluginHost()
  if (host === null) return

  const records = Object.values(usePluginInstallStore.getState().records)
  if (records.length === 0) return

  bootMark('plugin-bootstrap:start')

  // Hash every enabled plugin's bundle IN PARALLEL — sha256Hex is the
  // dominant cost in this path (each call hashes the full plugin source
  // through SubtleCrypto). Running them serially used to block ~80ms
  // per plugin on a cold iOS boot. Promise.all lets the browser fan the
  // work out across cores and yields to the main thread between each
  // SubtleCrypto await.
  const enabled = records.filter(r => r.enabled)
  const hashes = await Promise.all(enabled.map(r => sha256Hex(r.mainSource)))

  // Load each verified plugin, yielding to main between spawns so the
  // iOS watchdog never sees a single long task. Worker creation itself
  // is async (postMessage / module-fetch), but the synchronous setup
  // around it can still pile up if a user has a dozen plugins.
  for (let i = 0; i < enabled.length; i++) {
    const record = enabled[i]
    if (hashes[i] !== record.hash) {
      useToastStore.getState().addToast({
        kind: 'error',
        message: `Plugin "${record.manifest.id}" failed an integrity check and was not loaded.`,
      })
      continue
    }

    try {
      await host.load({
        pluginId: record.manifest.id,
        pluginSource: record.mainSource,
      })
      // Re-apply persisted capability revocations from previous
      // sessions before the worker gets a chance to make any
      // capability call from onActivate (the load() above already
      // ran onActivate, but the worker can also fire requests on
      // the next event loop tick — better to apply right away).
      for (const perm of record.revokedPermissions ?? []) {
        host.revokePermission(record.manifest.id, perm)
      }
    } catch (err) {
      // The host emits bootError separately, which lands in the toast
      // via the listener. Swallow here so one bad plugin does not
      // prevent the rest from booting.
      void err
    }
    await yieldToMain()
  }

  bootMark('plugin-bootstrap:end')
  bootMeasure('plugin-bootstrap', 'plugin-bootstrap:start', 'plugin-bootstrap:end')
}

/**
 * Toggle a capability grant for an already-installed plugin. Writes
 * through to BOTH the persisted install record (so the change survives
 * a reload) and the in-memory PluginHost (so the next capability call
 * from the running worker rejects immediately).
 *
 * No-op when the plugin is unknown. Idempotent for the same value.
 */
export function setPluginPermissionRevoked(
  pluginId: string,
  permission: import('./manifest').PluginPermission,
  revoked: boolean,
): void {
  usePluginInstallStore.getState().setPermissionRevoked(pluginId, permission, revoked)
  const host = getPluginHost()
  if (host) {
    if (revoked) host.revokePermission(pluginId, permission)
    else host.restorePermission(pluginId, permission)
  }
}

/**
 * Unload + remove a plugin entirely. Both the runtime PluginHost
 * (terminate the Worker) and the persisted install store
 * (forget the record) are cleared.
 */
export function uninstallPlugin(pluginId: string): void {
  const host = getPluginHost()
  if (host) host.unload(pluginId)
  usePluginInstallStore.getState().uninstall(pluginId)
  usePluginStore.getState().remove(pluginId)
}

/**
 * Subscribe to workspace + note stores and push host:activeNoteChanged
 * to every loaded plugin whenever the active note changes.
 *
 * Without this, the worker boots with ctx.activeNote = null forever:
 * the user can switch notes all day and no plugin onActiveNoteChange
 * handler fires. Caught when Jon installed the word-count plugin and
 * the panel sat on its empty-state message.
 *
 * Cheap: we only call host.activeNoteChanged when the resolved id
 * actually changes OR when its content changes. No diffing per
 * plugin — every loaded plugin gets the same event.
 */
function wireActiveNoteTracker(host: PluginHost): void {
  // Resolve "the currently-active note" from workspace + note stores.
  // Mirrors the same logic getAllCommands uses.
  const computeActiveNote = ():
    | { id: string; title: string; folderPath: string; content: string }
    | null => {
    const ws = useWorkspaceStore.getState()
    const activePane = ws.panes.find((p) => p.id === ws.activePaneId) ?? ws.panes[0]
    const activeTab = activePane?.tabs.find((t) => t.id === activePane?.activeTabId)
    const noteId = activeTab?.kind === 'note' ? activeTab.noteId : null
    if (!noteId) return null

    const note = useNoteStore.getState().notes.find((n) => n.id === noteId)
    if (!note || note.isDeleted) return null

    const folders = useFolderStore.getState().folders
    const folderPath = buildFolderPath(note.folderId ?? null, folders)
    return {
      id: note.id,
      title: note.title ?? 'Untitled',
      folderPath,
      content: note.content ?? '',
    }
  }

  // Last snapshot, used to dedupe. id + content length + a short prefix
  // is enough — content equality is unlikely to false-positive at this
  // granularity, and stringifying full bodies for every keystroke is
  // wasteful.
  let lastKey: string | null = null
  const keyOf = (n: ReturnType<typeof computeActiveNote>): string | null =>
    n === null ? null : `${n.id}|${n.content.length}|${n.content.slice(0, 64)}`

  const broadcast = (): void => {
    const note = computeActiveNote()
    const key = keyOf(note)
    if (key === lastKey) return
    lastKey = key
    for (const plugin of host.listReady()) {
      host.activeNoteChanged(plugin.manifest.id, note)
    }
  }

  // Subscribe to all three stores. Each fires on every store mutation;
  // broadcast() is the dedupe.
  useWorkspaceStore.subscribe(broadcast)
  useNoteStore.subscribe(broadcast)
  useFolderStore.subscribe(broadcast)

  // Also broadcast on every plugin-ready event so a freshly-loaded
  // plugin gets the current note immediately instead of waiting for
  // the next user switch.
  host.on((event) => {
    if (event.type === 'ready') {
      const note = computeActiveNote()
      host.activeNoteChanged(event.pluginId, note)
    }
  })
}

/**
 * Wire `vault.events` fan-out. Subscribes to the note + workspace +
 * folder stores and translates each mutation into the right host call:
 *
 *   - Any noteStore / folderStore change → notifyVaultChanged()
 *   - A `notes` array mutation that changes a note's content / title /
 *     frontmatter (i.e. a save) → notifyNoteSaved(noteId)
 *   - A workspace active-tab transition that resolves to a different
 *     noteId → notifyActiveNoteIdChanged(noteId)
 *
 * The host debounces every signal at 250 ms (VAULT_EVENT_DEBOUNCE_MS),
 * so this wrapper does NOT bother coalescing — it just dispatches as
 * the store fires. Keystrokes in the editor are noisy; the debounce
 * absorbs the burst.
 */
function wireVaultEvents(host: PluginHost): void {
  type NoteSnap = { id: string; title: string; content: string; updatedAt: number; isDeleted: boolean }
  let lastNotes: Map<string, NoteSnap> = snapshotNotes(useNoteStore.getState().notes)
  let lastActiveNoteId: string | null = resolveActiveNoteId()

  useNoteStore.subscribe((state) => {
    const next = snapshotNotes(state.notes)
    let vaultDirty = false

    // Detect adds, deletions, and content / title changes.
    for (const [id, cur] of next) {
      const prev = lastNotes.get(id)
      if (!prev) {
        vaultDirty = true
        host.notifyNoteSaved(id)
        continue
      }
      if (
        prev.content !== cur.content ||
        prev.title !== cur.title ||
        prev.isDeleted !== cur.isDeleted
      ) {
        vaultDirty = true
        host.notifyNoteSaved(id)
      }
    }
    for (const id of lastNotes.keys()) {
      if (!next.has(id)) vaultDirty = true
    }

    if (vaultDirty) host.notifyVaultChanged()
    lastNotes = next
  })

  useFolderStore.subscribe(() => {
    host.notifyVaultChanged()
  })

  useWorkspaceStore.subscribe(() => {
    const cur = resolveActiveNoteId()
    if (cur !== lastActiveNoteId) {
      lastActiveNoteId = cur
      host.notifyActiveNoteIdChanged(cur)
    }
  })
}

function snapshotNotes(
  notes: ReadonlyArray<{ id: string; title?: string; content?: string; updatedAt?: number; isDeleted?: boolean }>,
): Map<string, { id: string; title: string; content: string; updatedAt: number; isDeleted: boolean }> {
  const map = new Map<string, { id: string; title: string; content: string; updatedAt: number; isDeleted: boolean }>()
  for (const n of notes) {
    map.set(n.id, {
      id: n.id,
      title: n.title ?? '',
      content: n.content ?? '',
      updatedAt: n.updatedAt ?? 0,
      isDeleted: n.isDeleted ?? false,
    })
  }
  return map
}

function resolveActiveNoteId(): string | null {
  const ws = useWorkspaceStore.getState()
  const activePane = ws.panes.find((p) => p.id === ws.activePaneId) ?? ws.panes[0]
  const activeTab = activePane?.tabs.find((t) => t.id === activePane?.activeTabId)
  if (!activeTab) return null
  if (activeTab.kind !== 'note') return null
  const note = useNoteStore.getState().notes.find((n) => n.id === activeTab.noteId)
  if (!note || note.isDeleted) return null
  return note.id
}

function buildFolderPath(
  folderId: string | null,
  folders: ReadonlyArray<{ id: string; name: string; parentId: string | null }>,
): string {
  if (!folderId) return ''
  const parts: string[] = []
  const byId = new Map(folders.map((f) => [f.id, f] as const))
  let cur: string | null = folderId
  while (cur) {
    const f = byId.get(cur)
    if (!f) break
    parts.unshift(f.name)
    cur = f.parentId
  }
  return parts.join('/')
}

function wireListener(host: PluginHost): void {
  const store = usePluginStore.getState()
  const toast = useToastStore.getState()

  host.on((event) => {
    switch (event.type) {
      case 'ready':
        store.addReady(event.manifest)
        toast.addToast({
          kind: 'success',
          message: `Plugin loaded: ${event.manifest.name}`,
        })
        return

      case 'bootError':
        toast.addToast({
          kind: 'error',
          message: `Plugin "${event.pluginId}" failed to load: ${event.message}`,
        })
        // bootError happens BEFORE ready, so the plugin is not yet in
        // the store; nothing to append against.
        return

      case 'notify':
        toast.addToast({ kind: 'info', message: event.message })
        return

      case 'workerError':
        store.appendError(event.pluginId, event.message)
        // Also forward into the global error reporter so prod logs
        // capture the failure, not just the per-plugin error list.
        void import('@/utils/errorReporter').then(({ reportError }) => {
          reportError(new Error(`Plugin worker error: ${event.message}`), { pluginId: event.pluginId })
        })
        return

      case 'rateLimited':
        toast.addToast({
          kind: 'error',
          message: `Plugin "${event.pluginId}" is firing messages too fast and has been muted for one second.`,
        })
        return

      case 'commandHandled':
        if (event.error) {
          store.appendError(event.pluginId, `Command ${event.commandId} failed: ${event.error}`)
        }
        return

      case 'panelContent':
      case 'renderResult':
      case 'insertText':
        // Routed by the surface adapters themselves, not by this glue.
        // Adapters subscribe directly to the host via `host.on(...)`.
        return

      case 'fileSaveRequested':
        void handleFileSaveRequest(host, event)
        return

      case 'fileOpenRequested':
        void handleFileOpenRequest(host, event)
        return

      case 'vaultReadRequested':
        void handleVaultReadRequest(host, event)
        return

      case 'directoryOpenRequested':
        void handleDirectoryOpenRequest(host, event)
        return
    }
  })
}

/**
 * Snapshot the active note store, serialise to plain objects, and post
 * back to the plugin worker. The `vault.read.all` permission gate has
 * already been checked in PluginHost; this handler only owns the
 * snapshot + chunking work.
 *
 * Per the perf budget (docs/plugins-v1.2-plan.md §9 + issue #79) the
 * snapshot may not block the main thread for more than 50 ms on a
 * 5000-note vault. The streaming path yields between chunks via the
 * shared `streamVaultSnapshot` helper; the one-shot `getAllNotes` path
 * relies on the post-snapshot SHA cache (a second call within the same
 * SHA is a single hash compare).
 */
async function handleVaultReadRequest(
  host: PluginHost,
  event: Extract<import('./PluginHost').PluginHostEvent, { type: 'vaultReadRequested' }>,
): Promise<void> {
  const { pluginId, requestSeq, mode, noteId, chunkSize } = event

  // Guard: the note store hydrates from IndexedDB at boot. A plugin
  // that fires `getAllNotes()` from `onActivate` may race the hydrate;
  // surface a clear retry message instead of returning an empty array
  // that the plugin would silently cache.
  const notes = useNoteStore.getState().notes
  const hasHydratedState = (useNoteStore as unknown as {
    persist?: { hasHydrated: () => boolean }
  }).persist
  if (hasHydratedState && typeof hasHydratedState.hasHydrated === 'function' && !hasHydratedState.hasHydrated() && notes.length === 0) {
    if (mode === 'stream') {
      host.respondVaultStreamChunk(pluginId, requestSeq, {
        chunkIndex: 0,
        notes: [],
        error: 'Vault not yet loaded.',
      })
    } else {
      host.respondVaultRead(pluginId, requestSeq, { ok: false, error: 'Vault not yet loaded.' })
    }
    return
  }

  try {
    if (mode === 'one') {
      const note = snapshotNoteById(noteId ?? '')
      host.respondVaultRead(pluginId, requestSeq, { ok: true, note })
      return
    }

    if (mode === 'all') {
      const snapshot = snapshotAllNotes()
      const bytes = projectPayloadSize(snapshot)
      if (bytes > MAX_GET_ALL_BYTES) {
        host.respondVaultRead(pluginId, requestSeq, {
          ok: false,
          error: 'Vault too large; use stream().',
        })
        return
      }
      host.respondVaultRead(pluginId, requestSeq, { ok: true, notes: snapshot })
      return
    }

    // mode === 'stream' — paginate, yielding between chunks. We poll
    // the host's revocation state before every chunk so a mid-flight
    // toggle in Settings terminates the iterator with a clear error.
    let chunkIndexEmitted = 0
    await streamVaultSnapshot({
      ...(typeof chunkSize === 'number' ? { chunkSize } : {}),
      isAborted: () =>
        host.hasPermission(pluginId, 'vault.read.all')
          ? null
          : 'Permission "vault.read.all" was revoked.',
      onChunk: (slice, chunkIndex) => {
        chunkIndexEmitted = chunkIndex
        host.respondVaultStreamChunk(pluginId, requestSeq, {
          chunkIndex,
          notes: slice,
        })
      },
      onAbort: (reason) => {
        host.respondVaultStreamChunk(pluginId, requestSeq, {
          chunkIndex: chunkIndexEmitted + 1,
          notes: [],
          error: reason,
        })
      },
      onEnd: () => {
        host.respondVaultStreamChunk(pluginId, requestSeq, {
          chunkIndex: chunkIndexEmitted + 1,
          notes: [],
        })
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (mode === 'stream') {
      host.respondVaultStreamChunk(pluginId, requestSeq, {
        chunkIndex: 0,
        notes: [],
        error: message,
      })
    } else {
      host.respondVaultRead(pluginId, requestSeq, { ok: false, error: message })
    }
  }
}

/** Open the native save dialog, write the plugin's bytes to it.
 *  Falls back to a `<a download>` link when the browser does not
 *  expose `showSaveFilePicker` (Safari, Firefox). The fallback path
 *  cannot let the user pick a directory — the browser saves to the
 *  default downloads location with the suggested name.
 */
async function handleFileSaveRequest(
  host: PluginHost,
  event: Extract<import('./PluginHost').PluginHostEvent, { type: 'fileSaveRequested' }>,
): Promise<void> {
  const { pluginId, requestSeq, suggestedName, mimeType, bytesBase64 } = event
  try {
    const bytes = base64ToBytes(bytesBase64)
    // Cast through ArrayBuffer to satisfy TS's strict BlobPart typing —
    // Uint8Array<ArrayBufferLike> is not narrowed to <ArrayBuffer> in
    // some lib targets.
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
    const w = window as unknown as {
      showSaveFilePicker?: (opts: { suggestedName?: string; types?: unknown[] }) => Promise<FileSystemFileHandle>
    }
    if (typeof w.showSaveFilePicker === 'function') {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'File', accept: { [mimeType]: extensionFromName(suggestedName) } }],
      })
      const writable = await (handle as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable()
      await writable.write(blob)
      await writable.close()
      host.respondFileSave(pluginId, requestSeq, { ok: true })
      return
    }
    // Fallback: anchor download.
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    host.respondFileSave(pluginId, requestSeq, { ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('aborted') || message.includes('Abort')) {
      host.respondFileSave(pluginId, requestSeq, { ok: false, error: 'User cancelled the save dialog.' })
    } else {
      host.respondFileSave(pluginId, requestSeq, { ok: false, error: message })
    }
  }
}

async function handleFileOpenRequest(
  host: PluginHost,
  event: Extract<import('./PluginHost').PluginHostEvent, { type: 'fileOpenRequested' }>,
): Promise<void> {
  const { pluginId, requestSeq, accept } = event
  try {
    const w = window as unknown as {
      showOpenFilePicker?: (opts: { types?: unknown[]; multiple?: boolean }) => Promise<FileSystemFileHandle[]>
    }
    let file: File
    if (typeof w.showOpenFilePicker === 'function') {
      const handles = await w.showOpenFilePicker({
        multiple: false,
        ...(accept && accept.length > 0
          ? { types: [{ description: 'File', accept: acceptToTypes(accept) }] }
          : {}),
      })
      file = await handles[0].getFile()
    } else {
      // Fallback: an <input type=file> that resolves when the user picks.
      file = await pickFileViaInput(accept)
    }
    const arrayBuf = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuf)
    host.respondFileOpen(pluginId, requestSeq, {
      ok: true,
      bytesBase64: bytesToBase64(bytes),
      filename: file.name,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('aborted') || message.includes('Abort') || message === 'cancelled') {
      // Cancellation is not an error from the plugin's view — return null.
      host.respondFileOpen(pluginId, requestSeq, { ok: true })
    } else {
      host.respondFileOpen(pluginId, requestSeq, { ok: false, error: message })
    }
  }
}

function pickFileViaInput(accept: string[] | undefined): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept && accept.length > 0) input.accept = accept.join(',')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.onchange = () => {
      const f = input.files?.[0]
      input.remove()
      if (f) resolve(f)
      else reject(new Error('cancelled'))
    }
    // Cancellation has no DOM signal; treat blur as cancel after a tick.
    input.addEventListener('cancel', () => {
      input.remove()
      reject(new Error('cancelled'))
    })
    document.body.appendChild(input)
    input.click()
  })
}

/**
 * v1.2 `fs.open-directory` capability handler. Modern path uses
 * `showDirectoryPicker` (Chrome / Edge / Opera) and walks the returned
 * `FileSystemDirectoryHandle` recursively. Fallback path uses
 * `<input type="file" webkitdirectory>` for Safari + Firefox — the
 * existing single-file fallback at line ~458 above does NOT set
 * `webkitdirectory`, so the directory equivalent lives here.
 *
 * Both paths return `Array<{ name, path, blob }>`. `path` is the
 * forward-slash relative path inside the picked root; `blob` lets the
 * plugin read each file's contents lazily.
 *
 * See plugins-v1.2-plan.md section 4.3 for the design.
 */
async function handleDirectoryOpenRequest(
  host: PluginHost,
  event: Extract<import('./PluginHost').PluginHostEvent, { type: 'directoryOpenRequested' }>,
): Promise<void> {
  const { pluginId, requestSeq, extensions } = event
  // Manifest-level + runtime revocation gating already happened inside
  // PluginHost.handleWorkerMessage (PR C unified that layer). By the
  // time the singleton receives `directoryOpenRequested` the permission
  // is known to be both declared AND not revoked.
  const matcher = buildExtensionMatcher(extensions)
  try {
    const w = window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>
    }
    let entries: Array<{ name: string; path: string; blob: Blob }>
    if (typeof w.showDirectoryPicker === 'function') {
      const root = await w.showDirectoryPicker()
      entries = await walkDirectoryHandle(root, matcher)
    } else {
      entries = await pickDirectoryViaInput(matcher)
    }

    if (entries.length > MAX_DIRECTORY_ENTRIES) {
      host.respondDirectoryOpen(pluginId, requestSeq, {
        ok: false,
        error: `Directory too large: ${entries.length} entries exceeds the ${MAX_DIRECTORY_ENTRIES} cap.`,
      })
      return
    }

    host.respondDirectoryOpen(pluginId, requestSeq, { ok: true, entries })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (
      message.includes('aborted') ||
      message.includes('Abort') ||
      message === 'cancelled'
    ) {
      // Cancellation is not an error from the plugin's view — return
      // ok=true with no entries so ctx.fs.openDirectory resolves to
      // `null`. Mirrors the file-open fallback shape above.
      host.respondDirectoryOpen(pluginId, requestSeq, { ok: true })
    } else {
      host.respondDirectoryOpen(pluginId, requestSeq, { ok: false, error: message })
    }
  }
}

/** Safari + Firefox fallback. `<input type="file" webkitdirectory>`
 *  surfaces every file under the picked folder, but unlike the single
 *  `<input type=file>` fallback above this one has to handle:
 *
 *   - `webkitRelativePath` on each `File` (used as the `path`),
 *   - the `cancel` event firing when the user dismisses the picker
 *     (rejection path the unit tests cover).
 *
 *  The `accept` attribute is intentionally NOT set: webkitdirectory
 *  ignores it on most browsers, and we filter host-side via `matcher`
 *  anyway so the response stays consistent across paths. */
function pickDirectoryViaInput(
  matcher: (name: string) => boolean,
): Promise<Array<{ name: string; path: string; blob: Blob }>> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    // Non-standard but universally supported. The TS lib types it as a
    // string attribute so we set it via `setAttribute` to avoid a cast.
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.multiple = true
    input.style.position = 'fixed'
    input.style.left = '-9999px'

    let settled = false
    const cleanup = (): void => {
      input.remove()
    }

    input.onchange = () => {
      if (settled) return
      settled = true
      const files = input.files
      cleanup()
      if (!files || files.length === 0) {
        reject(new Error('cancelled'))
        return
      }
      const out: Array<{ name: string; path: string; blob: Blob }> = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        if (!matcher(f.name)) continue
        // webkitRelativePath includes the picked root's name as the
        // first segment, e.g. "MyVault/notes/a.md". Strip it so the
        // returned `path` is relative to the picked root, matching the
        // showDirectoryPicker path.
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name
        const slashIdx = rel.indexOf('/')
        const path = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel
        out.push({ name: f.name, path, blob: f as Blob })
      }
      resolve(out)
    }
    // Cancellation: modern browsers fire `cancel` when the picker is
    // dismissed without a selection. Unit-tested via the rejection
    // path — see permissions.test.ts / dedicated suite.
    input.addEventListener('cancel', () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('cancelled'))
    })
    document.body.appendChild(input)
    input.click()
  })
}


function acceptToTypes(accept: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const a of accept) {
    if (a.startsWith('.')) {
      // Group all extensions under a generic mime; File System Access
      // API requires types as { mime: ['.ext'] } pairs.
      const key = '*/*'
      if (!out[key]) out[key] = []
      out[key].push(a)
    } else {
      out[a] = []
    }
  }
  return out
}

function extensionFromName(name: string): string[] {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? [name.slice(idx)] : []
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
