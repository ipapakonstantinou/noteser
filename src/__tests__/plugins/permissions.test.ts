/**
 * @jest-environment node
 *
 * Plugin v1.1 capability gating. Covers two layers:
 *   1. Manifest validator accepts the new `permissions` field and
 *      rejects unknown values.
 *   2. PluginHost refuses worker:requestFileSave / worker:requestFileOpen
 *      when the plugin's manifest does not declare the corresponding
 *      permission. The refusal lands as a host:fileSaveResult /
 *      host:fileOpenResult with ok=false back to the worker.
 */

import { validateManifest, PERMISSIONS, PERMISSION_DESCRIPTIONS } from '@/plugins/manifest'
import { PluginHost, type MinimalWorker } from '@/plugins/PluginHost'
import type { HostToWorker, WorkerToHost } from '@/plugins/protocol'

describe('manifest permissions', () => {
  const base = {
    id: 'echo',
    name: 'Echo',
    version: '1.0.0',
    surfaces: { commands: [{ id: 'go', title: 'Go' }] },
  }

  test('accepts an empty / missing permissions field', () => {
    expect(validateManifest(base).ok).toBe(true)
    expect(validateManifest({ ...base, permissions: [] }).ok).toBe(true)
  })

  test('accepts the two v1.1 capabilities', () => {
    const r = validateManifest({ ...base, permissions: ['file-save', 'file-open'] })
    expect(r.ok).toBe(true)
    expect(r.manifest?.permissions).toEqual(['file-save', 'file-open'])
  })

  test('rejects an unknown permission', () => {
    const r = validateManifest({ ...base, permissions: ['network'] })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.toLowerCase().includes('network'))).toBe(true)
  })

  test('rejects non-string entries', () => {
    const r = validateManifest({ ...base, permissions: ['file-save', 42] })
    expect(r.ok).toBe(false)
  })

  test('deduplicates repeats silently', () => {
    const r = validateManifest({ ...base, permissions: ['file-save', 'file-save'] })
    expect(r.ok).toBe(true)
    expect(r.manifest?.permissions).toEqual(['file-save'])
  })

  test('rejects when "permissions" is not an array', () => {
    const r = validateManifest({ ...base, permissions: 'file-save' as unknown as string[] })
    expect(r.ok).toBe(false)
  })

  test('PERMISSION_DESCRIPTIONS covers every PERMISSIONS entry', () => {
    for (const p of PERMISSIONS) {
      expect(typeof PERMISSION_DESCRIPTIONS[p]).toBe('string')
      expect(PERMISSION_DESCRIPTIONS[p].length).toBeGreaterThan(0)
    }
  })
})

// ─── PluginHost permission gating ───────────────────────────────────────

function makeFakeWorker(manifest: {
  id: string
  name: string
  version: string
  surfaces: object
  permissions?: string[]
}): { worker: MinimalWorker; sent: HostToWorker[]; inject: (data: unknown) => void } {
  const sent: HostToWorker[] = []
  let handler: ((event: MessageEvent) => void) | null = null
  const worker: MinimalWorker = {
    onmessage: null,
    postMessage(message: unknown) {
      sent.push(message as HostToWorker)
      const msg = message as HostToWorker
      if (msg.type === 'host:boot') {
        queueMicrotask(() => {
          handler?.({
            data: { type: 'worker:ready', seq: msg.seq, manifest } as WorkerToHost,
          } as MessageEvent)
        })
      }
    },
    terminate() {
      handler = null
    },
  } as MinimalWorker
  Object.defineProperty(worker, 'onmessage', {
    configurable: true,
    get() {
      return handler
    },
    set(v) {
      handler = v
    },
  })
  return {
    worker,
    sent,
    inject(data: unknown) {
      handler?.({ data } as MessageEvent)
    },
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('PluginHost permission gate', () => {
  test('refuses requestFileSave when permission not declared', async () => {
    const fake = makeFakeWorker({
      id: 'no-perms',
      name: 'No perms',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'no-perms', pluginSource: '' })

    // Plugin emits a save request with no file-save permission.
    fake.inject({
      type: 'worker:requestFileSave',
      seq: 7,
      suggestedName: 'x.pdf',
      mimeType: 'application/pdf',
      bytesBase64: 'AAA',
    })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:fileSaveResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:fileSaveResult') {
      expect(reply.ok).toBe(false)
      expect(reply.requestSeq).toBe(7)
      expect(reply.error).toMatch(/file-save/)
    }
  })

  test('refuses requestFileOpen when permission not declared', async () => {
    const fake = makeFakeWorker({
      id: 'no-perms2',
      name: 'No perms 2',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'no-perms2', pluginSource: '' })

    fake.inject({ type: 'worker:requestFileOpen', seq: 9 })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:fileOpenResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:fileOpenResult') {
      expect(reply.ok).toBe(false)
      expect(reply.requestSeq).toBe(9)
      expect(reply.error).toMatch(/file-open/)
    }
  })

  test('does NOT short-circuit when the permission IS declared', async () => {
    const fake = makeFakeWorker({
      id: 'with-perms',
      name: 'With perms',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['file-save'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: string[] = []
    host.on((e) => events.push(e.type))
    await host.load({ pluginId: 'with-perms', pluginSource: '' })

    fake.inject({
      type: 'worker:requestFileSave',
      seq: 11,
      suggestedName: 'x.pdf',
      mimeType: 'application/pdf',
      bytesBase64: 'AAA',
    })
    await flush()

    // The host emits fileSaveRequested for the singleton to handle —
    // it should NOT immediately reply with an error.
    expect(events).toContain('fileSaveRequested')
    const earlyError = fake.sent.find(
      (m) => m.type === 'host:fileSaveResult' && m.ok === false,
    )
    expect(earlyError).toBeUndefined()
  })

  test('initialRevokedPermissions seeded via load() gates a declared capability without a separate revokePermission() call', async () => {
    // The plugin DECLARES file-save, but the user had previously revoked
    // it. Passing the revocation through load() means it is in effect the
    // instant the worker is considered ready — no post-load revocation
    // loop, no reliance on microtask-vs-macrotask ordering.
    const fake = makeFakeWorker({
      id: 'pre-revoked',
      name: 'Pre revoked',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['file-save'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({
      pluginId: 'pre-revoked',
      pluginSource: '',
      initialRevokedPermissions: ['file-save'],
    })

    fake.inject({
      type: 'worker:requestFileSave',
      seq: 5,
      suggestedName: 'x.pdf',
      mimeType: 'application/pdf',
      bytesBase64: 'AAA',
    })
    await flush()

    const reply = fake.sent.find((m) => m.type === 'host:fileSaveResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:fileSaveResult') {
      expect(reply.ok).toBe(false)
      expect(reply.error).toMatch(/revoked/)
    }
  })

  test('respondFileSave sends ok=true on success', async () => {
    const fake = makeFakeWorker({
      id: 'p',
      name: 'P',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['file-save'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'p', pluginSource: '' })

    host.respondFileSave('p', 42, { ok: true })

    const reply = fake.sent.find((m) => m.type === 'host:fileSaveResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:fileSaveResult') {
      expect(reply.ok).toBe(true)
      expect(reply.requestSeq).toBe(42)
    }
  })

  test('respondFileOpen with bytes survives the round-trip', async () => {
    const fake = makeFakeWorker({
      id: 'q',
      name: 'Q',
      version: '1.0.0',
      surfaces: { commands: [{ id: 'go', title: 'Go' }] },
      permissions: ['file-open'],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'q', pluginSource: '' })

    host.respondFileOpen('q', 99, {
      ok: true,
      bytesBase64: 'aGVsbG8=', // "hello"
      filename: 'note.md',
    })

    const reply = fake.sent.find((m) => m.type === 'host:fileOpenResult')
    expect(reply).toBeDefined()
    if (reply && reply.type === 'host:fileOpenResult') {
      expect(reply.ok).toBe(true)
      expect(reply.bytesBase64).toBe('aGVsbG8=')
      expect(reply.filename).toBe('note.md')
    }
  })
})
