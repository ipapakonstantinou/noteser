/**
 * @jest-environment node
 *
 * approvedManifestAuthority.test.ts
 *
 * manifest.json (what the install dialog shows and the install record keeps)
 * and main.js (what the worker declares at boot) are two separate artifacts.
 * The host used to take the worker's copy as authoritative, so a plugin could
 * publish a modest manifest for the approval dialog and hand itself extra
 * permissions or surfaces at runtime.
 *
 * Both branches are covered: a boot whose grant-bearing fields drift from the
 * approved manifest is refused, and a boot that agrees uses the APPROVED copy
 * rather than the worker's.
 */

import { PluginHost, type MinimalWorker } from '@/plugins/PluginHost'
import type { HostToWorker } from '@/plugins/protocol'
import type { PluginManifest } from '@/plugins/manifest'

const APPROVED: PluginManifest = {
  id: 'echo',
  name: 'Echo',
  version: '1.0.0',
  surfaces: { commands: [{ id: 'say', title: 'Say hello' }] },
  permissions: ['file-save'],
}

/** Worker fake that answers host:boot with whatever manifest it was given. */
function fakeWorkerFactory(declared: PluginManifest): () => MinimalWorker {
  return () => {
    let handler: ((event: MessageEvent) => void) | null = null
    const worker = {
      postMessage(message: unknown) {
        const msg = message as HostToWorker
        if (msg.type !== 'host:boot') return
        queueMicrotask(() => {
          handler?.({
            data: { type: 'worker:ready', seq: msg.seq, manifest: declared },
          } as MessageEvent)
        })
      },
      terminate() { handler = null },
    } as unknown as MinimalWorker
    Object.defineProperty(worker, 'onmessage', {
      configurable: true,
      get: () => handler,
      set: (v: ((event: MessageEvent) => void) | null) => { handler = v },
    })
    return worker
  }
}

function hostFor(declared: PluginManifest): PluginHost {
  return new PluginHost({ createWorker: fakeWorkerFactory(declared) })
}

const load = (host: PluginHost, approvedManifest?: PluginManifest) =>
  host.load({ pluginId: 'echo', pluginSource: 'export default {}', approvedManifest })

describe('worker-declared manifest cannot widen the approved grant', () => {
  test('a permission the install never showed refuses the boot', async () => {
    const host = hostFor({ ...APPROVED, permissions: ['file-save', 'vault.write'] })

    await expect(load(host, APPROVED)).rejects.toThrow(/permissions/i)
    expect(host.isLoaded('echo')).toBe(false)
  })

  test('an extra surface kind refuses the boot', async () => {
    const host = hostFor({
      ...APPROVED,
      surfaces: { ...APPROVED.surfaces, sidebarPanels: [{ id: 'p', title: 'P' }] },
    })

    await expect(load(host, APPROVED)).rejects.toThrow(/surfaces/i)
    expect(host.isLoaded('echo')).toBe(false)
  })

  test('dropping a permission also refuses — the two copies must agree', async () => {
    const host = hostFor({ ...APPROVED, permissions: [] })

    await expect(load(host, APPROVED)).rejects.toThrow(/permissions/i)
    expect(host.isLoaded('echo')).toBe(false)
  })
})

describe('when the grant agrees, the approved copy is the one used', () => {
  test('cosmetic drift boots, and the host keeps the approved manifest', async () => {
    // Same permission set and same surface kinds — but a renamed plugin, a
    // bumped version and a different command title. All ignored.
    const host = hostFor({
      id: 'echo',
      name: 'Echo (patched)',
      version: '9.9.9',
      surfaces: { commands: [{ id: 'say', title: 'Do something else' }] },
      permissions: ['file-save'],
    })

    const manifest = await load(host, APPROVED)

    expect(manifest).toEqual(APPROVED)
    expect(host.getManifest('echo')).toEqual(APPROVED)
    expect(host.getManifest('echo')?.name).toBe('Echo')
  })

  test('an empty surface array is not drift against an absent key', async () => {
    const host = hostFor({
      ...APPROVED,
      surfaces: { commands: [{ id: 'say', title: 'Say hello' }], sidebarPanels: [] },
    })

    await expect(load(host, APPROVED)).resolves.toEqual(APPROVED)
  })

  test('without an approved manifest the worker copy is still used', async () => {
    // The host is used directly by its own unit tests, which boot bare
    // workers; that path must keep working.
    const declared: PluginManifest = { ...APPROVED, name: 'From worker' }
    const host = hostFor(declared)

    await expect(load(host)).resolves.toEqual(declared)
    expect(host.getManifest('echo')?.name).toBe('From worker')
  })
})
