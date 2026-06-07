/**
 * @jest-environment node
 *
 * VNode event delivery — host → worker pipeline.
 *
 * Plugin API v1.2 shipped the VNode event ENVELOPE shape and the VNode
 * shapes (button / input / radio / link) that emit events. The dispatch
 * + routing pipeline was deferred to this follow-up.
 *
 * Tests:
 *   - `PluginHost.sendVNodeEvent` posts the correct `host:vnodeEvent`
 *     envelope per surface (panel / fullscreen / codeBlock).
 *   - Per-plugin rate limit caps delivery at `MAX_VNODE_EVENTS_PER_SECOND`.
 *   - `unload()` terminates the worker, so subsequent `sendVNodeEvent`
 *     calls do nothing (no envelope posted, no callback invoked).
 *
 * Real Web Workers are unavailable in node + jsdom; we inject a
 * FakeWorker via `PluginHostOptions.createWorker` that captures every
 * envelope and surfaces them to the test for assertion. The worker-side
 * dispatcher is unit-tested separately (it is a Set fan-out plus a
 * try/catch wrapper — no IO).
 */

import { PluginHost, type MinimalWorker } from '@/plugins/PluginHost'
import {
  MAX_VNODE_EVENTS_PER_SECOND,
  type HostToWorker,
  type HostVNodeEvent,
  type WorkerToHost,
} from '@/plugins/protocol'
import type { PluginManifest } from '@/plugins/manifest'

const manifest: PluginManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  surfaces: {
    sidebarPanels: [{ id: 'main', title: 'Main' }],
    fullscreenViews: [{ id: 'big', title: 'Big' }],
  },
}

interface FakeWorkerHandle {
  worker: MinimalWorker
  sent: HostToWorker[]
}

function makeFakeWorker(): FakeWorkerHandle {
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
            data: {
              type: 'worker:ready',
              seq: msg.seq,
              manifest,
            } satisfies WorkerToHost,
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
    get(): ((event: MessageEvent) => void) | null {
      return handler
    },
    set(v: ((event: MessageEvent) => void) | null) {
      handler = v
    },
  })

  return { worker, sent }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('PluginHost.sendVNodeEvent', () => {
  test('posts a host:vnodeEvent envelope with the panel source for a sidebar event', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'demo', pluginSource: '' })

    host.sendVNodeEvent(
      'demo',
      { kind: 'panel', panelId: 'main' },
      'click',
      { from: 'button' },
    )

    const sent = fake.sent.find((m) => m.type === 'host:vnodeEvent') as
      | HostVNodeEvent
      | undefined
    expect(sent).toBeDefined()
    expect(sent?.event).toBe('click')
    expect(sent?.payload).toEqual({ from: 'button' })
    expect(sent?.source).toEqual({ kind: 'panel', panelId: 'main' })
  })

  test('posts a fullscreen source descriptor for fullscreen events', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'demo', pluginSource: '' })

    host.sendVNodeEvent(
      'demo',
      { kind: 'fullscreen', viewId: 'big' },
      'submit',
      undefined,
    )

    const sent = fake.sent.find((m) => m.type === 'host:vnodeEvent') as
      | HostVNodeEvent
      | undefined
    expect(sent?.source).toEqual({ kind: 'fullscreen', viewId: 'big' })
  })

  test('posts a codeBlock source descriptor for code-block events', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'demo', pluginSource: '' })

    host.sendVNodeEvent(
      'demo',
      { kind: 'codeBlock', blockId: 'b1' },
      'graphpick',
      { id: 'n1' },
    )

    const sent = fake.sent.find((m) => m.type === 'host:vnodeEvent') as
      | HostVNodeEvent
      | undefined
    expect(sent?.source).toEqual({ kind: 'codeBlock', blockId: 'b1' })
    expect(sent?.payload).toEqual({ id: 'n1' })
  })

  test('drops empty event names without posting an envelope', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'demo', pluginSource: '' })

    host.sendVNodeEvent('demo', { kind: 'panel', panelId: 'main' }, '', null)
    expect(fake.sent.some((m) => m.type === 'host:vnodeEvent')).toBe(false)
  })

  test('no-op when the plugin id is unknown (post-unload safety)', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'demo', pluginSource: '' })
    host.unload('demo')

    host.sendVNodeEvent(
      'demo',
      { kind: 'panel', panelId: 'main' },
      'click',
      null,
    )
    expect(fake.sent.some((m) => m.type === 'host:vnodeEvent')).toBe(false)
  })
})

describe('PluginHost.sendVNodeEvent — rate limit', () => {
  test('drops events past MAX_VNODE_EVENTS_PER_SECOND in a 1-second window', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'demo', pluginSource: '' })

    // Fire one above the cap. The fake's sent[] captures every
    // postMessage so we count the host:vnodeEvent envelopes only.
    const overage = MAX_VNODE_EVENTS_PER_SECOND + 5
    for (let i = 0; i < overage; i++) {
      host.sendVNodeEvent(
        'demo',
        { kind: 'panel', panelId: 'main' },
        `e${i}`,
        null,
      )
    }
    await flushMicrotasks()

    const delivered = fake.sent.filter((m) => m.type === 'host:vnodeEvent')
    expect(delivered).toHaveLength(MAX_VNODE_EVENTS_PER_SECOND)
  })

  test('emits a vnodeEventRateLimited PluginHostEvent once per window when the cap is hit', async () => {
    const fake = makeFakeWorker()
    const host = new PluginHost({ createWorker: () => fake.worker })
    const rateLimits: string[] = []
    host.on((e) => {
      if (e.type === 'vnodeEventRateLimited') rateLimits.push(e.pluginId)
    })
    await host.load({ pluginId: 'demo', pluginSource: '' })

    for (let i = 0; i < MAX_VNODE_EVENTS_PER_SECOND * 2; i++) {
      host.sendVNodeEvent(
        'demo',
        { kind: 'panel', panelId: 'main' },
        'click',
        null,
      )
    }

    // Exactly one warning per window despite many drops.
    expect(rateLimits).toEqual(['demo'])
  })

  test('rate-limit window is per-plugin (one busy plugin does not starve another)', async () => {
    const fakeA = makeFakeWorker()
    const fakeB = makeFakeWorker()
    const host = new PluginHost({
      createWorker: (() => {
        let n = 0
        return () => (n++ === 0 ? fakeA.worker : fakeB.worker)
      })(),
    })
    await host.load({ pluginId: 'a', pluginSource: '' })
    await host.load({ pluginId: 'b', pluginSource: '' })

    for (let i = 0; i < MAX_VNODE_EVENTS_PER_SECOND * 2; i++) {
      host.sendVNodeEvent('a', { kind: 'panel', panelId: 'p' }, 'click', null)
    }
    // Plugin B should not be affected by A's storm.
    host.sendVNodeEvent('b', { kind: 'panel', panelId: 'p' }, 'click', null)

    const deliveredA = fakeA.sent.filter((m) => m.type === 'host:vnodeEvent')
    const deliveredB = fakeB.sent.filter((m) => m.type === 'host:vnodeEvent')
    expect(deliveredA).toHaveLength(MAX_VNODE_EVENTS_PER_SECOND)
    expect(deliveredB).toHaveLength(1)
  })
})

describe('PluginHost.sendVNodeEvent — cleanup on unload', () => {
  test('unload terminates the worker and subsequent sendVNodeEvent posts nothing', async () => {
    const fake = makeFakeWorker()
    let terminated = 0
    const origTerminate = fake.worker.terminate.bind(fake.worker)
    fake.worker.terminate = () => {
      terminated++
      origTerminate()
    }
    const host = new PluginHost({ createWorker: () => fake.worker })
    await host.load({ pluginId: 'demo', pluginSource: '' })

    // Sanity: one event delivers fine.
    host.sendVNodeEvent('demo', { kind: 'panel', panelId: 'main' }, 'e1', null)
    expect(
      fake.sent.filter((m) => m.type === 'host:vnodeEvent'),
    ).toHaveLength(1)

    host.unload('demo')
    expect(terminated).toBe(1)

    // Any further events must not post anything; the entry is gone.
    host.sendVNodeEvent('demo', { kind: 'panel', panelId: 'main' }, 'e2', null)
    host.sendVNodeEvent('demo', { kind: 'panel', panelId: 'main' }, 'e3', null)
    expect(
      fake.sent.filter((m) => m.type === 'host:vnodeEvent'),
    ).toHaveLength(1)
  })
})
