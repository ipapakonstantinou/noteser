/**
 * @jest-environment node
 *
 * PluginHost integration tests.
 *
 * Real Web Workers and Blob URLs are not available in Jest jsdom and
 * are messy in node. Instead we inject a FakeWorker via the
 * PluginHostOptions.createWorker hook. The fake mirrors the protocol
 * shape: postMessage → host:boot → reply worker:ready with the manifest;
 * invokeCommand → reply worker:commandHandled + worker:notify; etc.
 *
 * This validates the host's message routing + listener fan-out, NOT
 * the worker-side dispatch logic. workerEntry's logic is tested
 * separately in workerEntry.test.ts.
 */

import { PluginHost, type MinimalWorker, type PluginHostEvent } from '@/plugins/PluginHost'
import type { HostToWorker, WorkerToHost } from '@/plugins/protocol'
import type { PluginManifest } from '@/plugins/manifest'

const testManifest: PluginManifest = {
  id: 'echo',
  name: 'Echo',
  version: '1.0.0',
  surfaces: {
    commands: [{ id: 'say', title: 'Say hello' }],
    sidebarPanels: [{ id: 'panel', title: 'Echo' }],
  },
}

interface FakeWorkerHandle {
  worker: MinimalWorker
  sent: HostToWorker[]
  /** Push an arbitrary message into the host as if the worker emitted it. */
  inject(data: unknown): void
}

interface FakeWorkerScenario {
  /** If set, override the manifest the worker reports back. */
  manifest?: PluginManifest
  /** When set, reply with worker:bootError instead of worker:ready. */
  bootError?: string
  /** Per-command behaviour: when invoked, emit these replies. */
  onCommand?: (commandId: string, seq: number) => WorkerToHost[]
}

/** A FakeWorker that responds to host messages with canned replies and
 *  exposes an `inject` hook so tests can simulate spontaneous worker
 *  messages (e.g. malformed-shape regression tests). */
function makeFakeWorker(scenario: FakeWorkerScenario): FakeWorkerHandle {
  const sent: HostToWorker[] = []
  let handler: ((event: MessageEvent) => void) | null = null

  const worker: MinimalWorker = {
    onmessage: null,
    postMessage(message: unknown) {
      sent.push(message as HostToWorker)
      const msg = message as HostToWorker
      queueMicrotask(() => {
        if (!handler) return
        for (const reply of repliesFor(msg, scenario)) {
          handler({ data: reply } as MessageEvent)
        }
      })
    },
    terminate() {
      handler = null
    },
  } as MinimalWorker

  Object.defineProperty(worker, 'onmessage', {
    configurable: true,
    get(): ((event: MessageEvent) => void) | null {
      return handler
    },
    set(v: ((event: MessageEvent) => void) | null) {
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

function repliesFor(msg: HostToWorker, scenario: FakeWorkerScenario): WorkerToHost[] {
  switch (msg.type) {
    case 'host:boot':
      if (scenario.bootError) {
        return [{ type: 'worker:bootError', seq: msg.seq, message: scenario.bootError }]
      }
      return [
        {
          type: 'worker:ready',
          seq: msg.seq,
          manifest: scenario.manifest ?? testManifest,
        },
      ]
    case 'host:invokeCommand':
      if (scenario.onCommand) return scenario.onCommand(msg.commandId, msg.seq)
      return [{ type: 'worker:commandHandled', seq: msg.seq, commandId: msg.commandId }]
    default:
      return []
  }
}

describe('PluginHost', () => {
  test('load() resolves with the worker manifest', async () => {
    const fake = makeFakeWorker({})
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: PluginHostEvent[] = []
    host.on((e) => events.push(e))

    const manifest = await host.load({
      pluginId: 'echo',
      pluginSource: '/* unused */',
    })

    expect(manifest.id).toBe('echo')
    expect(events.some((e) => e.type === 'ready' && e.pluginId === 'echo')).toBe(true)
    expect(host.listReady()).toHaveLength(1)
  })

  test('load() rejects + emits bootError when worker reports failure', async () => {
    const fake = makeFakeWorker({ bootError: 'manifest invalid' })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: PluginHostEvent[] = []
    host.on((e) => events.push(e))

    await expect(
      host.load({ pluginId: 'echo', pluginSource: '' }),
    ).rejects.toThrow(/manifest invalid/)

    expect(events.some((e) => e.type === 'bootError')).toBe(true)
    expect(host.listReady()).toHaveLength(0)
  })

  test('boot timeout fires after timeoutMs and unloads the plugin', async () => {
    const silent: MinimalWorker = {
      onmessage: null,
      postMessage() {
        /* no reply */
      },
      terminate() {
        /* */
      },
    }
    const host = new PluginHost({ createWorker: () => silent })

    await expect(
      host.load({
        pluginId: 'slow',
        pluginSource: '',
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/boot timed out/)

    expect(host.isLoaded('slow')).toBe(false)
  })

  test('invokeCommand round-trips a commandHandled event', async () => {
    const fake = makeFakeWorker({})
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: PluginHostEvent[] = []
    host.on((e) => events.push(e))

    await host.load({ pluginId: 'echo', pluginSource: '' })
    host.invokeCommand('echo', 'say')

    await flushMicrotasks()

    const invoked = fake.sent.find((m) => m.type === 'host:invokeCommand')
    expect(invoked).toBeDefined()
    if (invoked && invoked.type === 'host:invokeCommand') {
      expect(invoked.commandId).toBe('say')
    }
    expect(
      events.some((e) => e.type === 'commandHandled' && e.commandId === 'say'),
    ).toBe(true)
  })

  test('plugin can emit notify and the host forwards it', async () => {
    const fake = makeFakeWorker({
      onCommand: (commandId, seq) => [
        { type: 'worker:notify', seq, message: `ran ${commandId}` },
        { type: 'worker:commandHandled', seq, commandId },
      ],
    })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: PluginHostEvent[] = []
    host.on((e) => events.push(e))

    await host.load({ pluginId: 'echo', pluginSource: '' })
    host.invokeCommand('echo', 'say')
    await flushMicrotasks()

    const notify = events.find((e) => e.type === 'notify')
    expect(notify).toBeDefined()
    if (notify && notify.type === 'notify') {
      expect(notify.message).toBe('ran say')
    }
  })

  test('unrecognised worker message shapes raise a workerError', async () => {
    const fake = makeFakeWorker({})
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: PluginHostEvent[] = []
    host.on((e) => events.push(e))

    await host.load({ pluginId: 'echo', pluginSource: '' })

    fake.inject({ type: 'bogus', seq: 99 })
    expect(events.some((e) => e.type === 'workerError')).toBe(true)
  })

  test('unload() terminates the worker and clears the plugin', async () => {
    const fake = makeFakeWorker({})
    let terminated = 0
    const original = fake.worker.terminate.bind(fake.worker)
    fake.worker.terminate = () => {
      terminated++
      original()
    }

    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'echo', pluginSource: '' })
    expect(host.isLoaded('echo')).toBe(true)

    host.unload('echo')
    expect(host.isLoaded('echo')).toBe(false)
    expect(terminated).toBe(1)
  })
})

// v1.2 PR B — fullscreen surface routing through PluginHost.
describe('PluginHost — fullscreen wire (PR B)', () => {
  const manifestWithFs: PluginManifest = {
    id: 'echo',
    name: 'Echo',
    version: '1.0.0',
    surfaces: {
      commands: [{ id: 'say', title: 'Say hello' }],
      fullscreenViews: [{ id: 'main', title: 'Main view' }],
    },
  }

  test('worker:openFullscreen for a declared view emits fullscreenOpenRequested', async () => {
    const fake = makeFakeWorker({ manifest: manifestWithFs })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: PluginHostEvent[] = []
    host.on((e) => events.push(e))

    await host.load({ pluginId: 'echo', pluginSource: '' })

    fake.inject({ type: 'worker:openFullscreen', seq: 42, viewId: 'main' })
    await flushMicrotasks()

    const requested = events.find((e) => e.type === 'fullscreenOpenRequested')
    expect(requested).toBeDefined()
    if (requested && requested.type === 'fullscreenOpenRequested') {
      expect(requested.viewId).toBe('main')
      expect(requested.requestSeq).toBe(42)
    }
  })

  test('worker:openFullscreen for an UNDECLARED view replies with an error and no request fires', async () => {
    const fake = makeFakeWorker({ manifest: manifestWithFs })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: PluginHostEvent[] = []
    host.on((e) => events.push(e))

    await host.load({ pluginId: 'echo', pluginSource: '' })

    fake.inject({ type: 'worker:openFullscreen', seq: 7, viewId: 'not-declared' })
    await flushMicrotasks()

    expect(events.some((e) => e.type === 'fullscreenOpenRequested')).toBe(false)
    const sent = fake.sent.find((m) => m.type === 'host:fullscreenOpenResult')
    expect(sent).toBeDefined()
    if (sent && sent.type === 'host:fullscreenOpenResult') {
      expect(sent.ok).toBe(false)
      expect(sent.requestSeq).toBe(7)
      expect(sent.error).toMatch(/not declared/)
    }
  })

  test('respondFullscreenOpen + notifyFullscreenOpened post the right envelopes', async () => {
    const fake = makeFakeWorker({ manifest: manifestWithFs })
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'echo', pluginSource: '' })

    host.respondFullscreenOpen('echo', 99, { ok: true })
    host.notifyFullscreenOpened('echo', 'main')

    const okResult = fake.sent.find(
      (m) => m.type === 'host:fullscreenOpenResult' && 'requestSeq' in m && m.requestSeq === 99,
    )
    expect(okResult).toBeDefined()
    const opened = fake.sent.find((m) => m.type === 'host:fullscreenOpened')
    expect(opened).toBeDefined()
    if (opened && opened.type === 'host:fullscreenOpened') {
      expect(opened.viewId).toBe('main')
    }
  })

  test('worker:closeFullscreen + worker:setFullscreenContent fan out as PluginHostEvents', async () => {
    const fake = makeFakeWorker({ manifest: manifestWithFs })
    const host = new PluginHost({ createWorker: () => fake.worker })
    const events: PluginHostEvent[] = []
    host.on((e) => events.push(e))

    await host.load({ pluginId: 'echo', pluginSource: '' })

    fake.inject({ type: 'worker:closeFullscreen', seq: 10, viewId: 'main' })
    fake.inject({
      type: 'worker:setFullscreenContent',
      seq: 11,
      viewId: 'main',
      node: { tag: 'text', value: 'hi' },
    })
    await flushMicrotasks()

    expect(events.some((e) => e.type === 'fullscreenCloseRequested')).toBe(true)
    const content = events.find((e) => e.type === 'fullscreenContent')
    expect(content).toBeDefined()
    if (content && content.type === 'fullscreenContent') {
      expect(content.viewId).toBe('main')
      expect((content.node as { value: string }).value).toBe('hi')
    }
  })
})

/** Two microtask ticks — enough for fake-worker queueMicrotask replies
 *  to land and for the host to dispatch to listeners. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
