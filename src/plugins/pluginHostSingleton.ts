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
import { usePluginStore } from '@/stores/pluginStore'
import { usePluginInstallStore, type InstalledPluginRecord } from '@/stores/pluginInstallStore'
import { useToastStore } from '@/stores/toastStore'
import { fetchPluginFromUrl, sha256Hex } from './installer'

let instance: PluginHost | null = null

/** Get the app-wide PluginHost. Returns null during SSR — callers
 *  must guard for that. */
export function getPluginHost(): PluginHost | null {
  if (typeof window === 'undefined') return null
  if (instance === null) {
    instance = new PluginHost({ createWorker: spawnPluginWorker })
    wireListener(instance)
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
 * Fetch + validate + persist a plugin from a manifest URL, then
 * boot it. Throws on any failure; toast notifications come via the
 * existing host event listener.
 *
 * The PluginsSettingsPanel calls this after the user confirms the
 * install in the preview modal.
 */
export async function installPluginFromUrl(manifestUrl: string): Promise<void> {
  const host = getPluginHost()
  if (host === null) throw new Error('Plugins are unavailable during server-side rendering.')

  const fetched = await fetchPluginFromUrl(manifestUrl)
  const record: InstalledPluginRecord = {
    manifest: fetched.manifest,
    mainSource: fetched.mainSource,
    hash: fetched.hash,
    sourceUrl: fetched.sourceUrl,
    addedAt: Date.now(),
    enabled: true,
  }
  usePluginInstallStore.getState().install(record)

  if (host.isLoaded(record.manifest.id)) host.unload(record.manifest.id)
  await host.load({
    pluginId: record.manifest.id,
    pluginSource: record.mainSource,
  })
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
  for (const record of records) {
    if (!record.enabled) continue

    const actualHash = await sha256Hex(record.mainSource)
    if (actualHash !== record.hash) {
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
    } catch (err) {
      // The host emits bootError separately, which lands in the toast
      // via the listener. Swallow here so one bad plugin does not
      // prevent the rest from booting.
      void err
    }
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
    }
  })
}
