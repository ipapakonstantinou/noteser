/**
 * @jest-environment node
 *
 * v1.3 (L1) — PluginHost high-frequency coalescing + budget.
 *
 * Pointer MOVE events are high-frequency: the host collapses them to at
 * most one per (pluginId, event-name, target) per animation frame
 * (latest payload wins), gates the whole path on the surface's manifest
 * `interaction` opt-in, and charges flushes to a SEPARATE budget
 * (`MAX_HF_EVENTS_PER_SECOND`) that does not touch the discrete
 * `MAX_VNODE_EVENTS_PER_SECOND` ceiling. Discrete pointerdown/up bypass
 * coalescing entirely.
 *
 * A capturing `requestFrame` lets each test flush deterministically.
 */

import { PluginHost, type MinimalWorker } from '@/plugins/PluginHost'
import {
  MAX_HF_EVENTS_PER_SECOND,
  MAX_VNODE_EVENTS_PER_SECOND,
  type HostToWorker,
  type HostVNodeEvent,
  type WorkerToHost,
} from '@/plugins/protocol'
import type { PluginManifest } from '@/plugins/manifest'

const interactiveManifest: PluginManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  surfaces: {
    fullscreenViews: [{ id: 'big', title: 'Big', interaction: { pointer: true } }],
    sidebarPanels: [{ id: 'plain', title: 'Plain' }],
  },
}

interface FakeWorkerHandle {
  worker: MinimalWorker
  sent: HostToWorker[]
}

function makeFakeWorker(manifest: PluginManifest): FakeWorkerHandle {
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
            data: { type: 'worker:ready', seq: msg.seq, manifest } satisfies WorkerToHost,
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
    get: () => handler,
    set: (v: ((event: MessageEvent) => void) | null) => {
      handler = v
    },
  })
  return { worker, sent }
}

/** Build a host whose frame flush is driven manually by the returned
 *  `flush()` (no real rAF). */
function makeHost(fake: FakeWorkerHandle) {
  let pendingFrame: (() => void) | null = null
  const host = new PluginHost({
    createWorker: () => fake.worker,
    requestFrame: (cb) => {
      pendingFrame = cb
      return 1
    },
  })
  const flush = () => {
    const cb = pendingFrame
    pendingFrame = null
    cb?.()
  }
  const hasPendingFrame = () => pendingFrame !== null
  return { host, flush, hasPendingFrame }
}

const moves = (sent: HostToWorker[]) =>
  sent.filter((m): m is HostVNodeEvent => m.type === 'host:vnodeEvent')

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('PluginHost HF coalescing — onPointerMove', () => {
  test('keeps only the latest pointermove per (event, target) per frame', async () => {
    const fake = makeFakeWorker(interactiveManifest)
    const { host, flush } = makeHost(fake)
    await host.load({ pluginId: 'demo', pluginSource: '' })

    const source: HostVNodeEvent['source'] = { kind: 'fullscreen', viewId: 'big' }
    for (let i = 0; i < 10; i++) {
      host.sendVNodeEvent('demo', source, 'drag', { x: i, y: i, target: 'n1' }, { highFrequency: true })
    }
    // Nothing delivered before the frame fires.
    expect(moves(fake.sent)).toHaveLength(0)

    flush()
    const delivered = moves(fake.sent)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].payload).toEqual({ x: 9, y: 9, target: 'n1' })
    expect(delivered[0].source).toEqual(source)
  })

  test('distinct targets each flush once per frame', async () => {
    const fake = makeFakeWorker(interactiveManifest)
    const { host, flush } = makeHost(fake)
    await host.load({ pluginId: 'demo', pluginSource: '' })
    const source: HostVNodeEvent['source'] = { kind: 'fullscreen', viewId: 'big' }

    host.sendVNodeEvent('demo', source, 'drag', { x: 1, target: 'a' }, { highFrequency: true })
    host.sendVNodeEvent('demo', source, 'drag', { x: 2, target: 'b' }, { highFrequency: true })
    host.sendVNodeEvent('demo', source, 'drag', { x: 3, target: 'a' }, { highFrequency: true })

    flush()
    const delivered = moves(fake.sent)
    expect(delivered).toHaveLength(2)
    expect(delivered.map((d) => (d.payload as { x: number }).x).sort()).toEqual([2, 3])
  })

  test('pointerdown/up bypass coalescing and deliver immediately', async () => {
    const fake = makeFakeWorker(interactiveManifest)
    const { host, hasPendingFrame } = makeHost(fake)
    await host.load({ pluginId: 'demo', pluginSource: '' })
    const source: HostVNodeEvent['source'] = { kind: 'fullscreen', viewId: 'big' }

    host.sendVNodeEvent('demo', source, 'down', { x: 0, y: 0, target: 'n1' })
    host.sendVNodeEvent('demo', source, 'up', { x: 0, y: 0, target: 'n1' })

    // Delivered synchronously, no frame needed.
    expect(moves(fake.sent).map((m) => m.event)).toEqual(['down', 'up'])
    expect(hasPendingFrame()).toBe(false)
  })

  test('HF budget is separate from the discrete budget', async () => {
    const fake = makeFakeWorker(interactiveManifest)
    const { host, flush } = makeHost(fake)
    await host.load({ pluginId: 'demo', pluginSource: '' })
    const source: HostVNodeEvent['source'] = { kind: 'fullscreen', viewId: 'big' }

    // Exhaust the discrete budget entirely.
    for (let i = 0; i < MAX_VNODE_EVENTS_PER_SECOND + 5; i++) {
      host.sendVNodeEvent('demo', source, `click${i}`, null)
    }
    const discreteDelivered = moves(fake.sent).length
    expect(discreteDelivered).toBe(MAX_VNODE_EVENTS_PER_SECOND)

    // HF events on distinct targets still flow — the discrete cap did
    // not consume the HF budget. Use distinct targets so coalescing
    // does not collapse them.
    for (let i = 0; i < 20; i++) {
      host.sendVNodeEvent('demo', source, 'drag', { x: i, target: `t${i}` }, { highFrequency: true })
    }
    flush()
    expect(moves(fake.sent).length - discreteDelivered).toBe(20)
  })

  test('HF flushes past MAX_HF_EVENTS_PER_SECOND are dropped within a window', async () => {
    const fake = makeFakeWorker(interactiveManifest)
    const { host, flush } = makeHost(fake)
    const warnings: string[] = []
    host.on((e) => {
      if (e.type === 'vnodeEventRateLimited') warnings.push(e.pluginId)
    })
    await host.load({ pluginId: 'demo', pluginSource: '' })
    const source: HostVNodeEvent['source'] = { kind: 'fullscreen', viewId: 'big' }

    const overage = MAX_HF_EVENTS_PER_SECOND + 10
    for (let i = 0; i < overage; i++) {
      host.sendVNodeEvent('demo', source, 'drag', { x: i, target: `t${i}` }, { highFrequency: true })
    }
    flush()
    expect(moves(fake.sent)).toHaveLength(MAX_HF_EVENTS_PER_SECOND)
    expect(warnings).toEqual(['demo'])
  })
})

describe('PluginHost HF gating — interaction opt-in', () => {
  test('a surface WITHOUT interaction opt-in drops HF events entirely', async () => {
    const fake = makeFakeWorker(interactiveManifest)
    const { host, flush, hasPendingFrame } = makeHost(fake)
    await host.load({ pluginId: 'demo', pluginSource: '' })

    // The 'plain' sidebar panel declared no interaction.
    const source: HostVNodeEvent['source'] = { kind: 'panel', panelId: 'plain' }
    for (let i = 0; i < 5; i++) {
      host.sendVNodeEvent('demo', source, 'drag', { x: i, target: 'n1' }, { highFrequency: true })
    }
    // No frame is even scheduled because nothing was enqueued.
    expect(hasPendingFrame()).toBe(false)
    flush()
    expect(moves(fake.sent)).toHaveLength(0)
  })

  test('discrete pointer events are NOT gated on interaction opt-in', async () => {
    const fake = makeFakeWorker(interactiveManifest)
    const { host } = makeHost(fake)
    await host.load({ pluginId: 'demo', pluginSource: '' })
    const source: HostVNodeEvent['source'] = { kind: 'panel', panelId: 'plain' }

    host.sendVNodeEvent('demo', source, 'down', { x: 0, y: 0, target: 'n1' })
    await flushMicrotasks()
    expect(moves(fake.sent).map((m) => m.event)).toEqual(['down'])
  })
})
