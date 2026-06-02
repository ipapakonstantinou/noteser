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

import { PluginHost } from './PluginHost'
import { usePluginStore } from '@/stores/pluginStore'
import { useToastStore } from '@/stores/toastStore'

let instance: PluginHost | null = null

/** Get the app-wide PluginHost. Returns null during SSR — callers
 *  must guard for that. */
export function getPluginHost(): PluginHost | null {
  if (typeof window === 'undefined') return null
  if (instance === null) {
    instance = new PluginHost()
    wireListener(instance)
  }
  return instance
}

/** Reset for tests only. Terminates every plugin and clears the
 *  singleton. */
export function resetPluginHostForTests(): void {
  if (instance === null) return
  for (const p of instance.listReady()) instance.unload(p.manifest.id)
  instance = null
  usePluginStore.getState().clear()
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
