/**
 * @jest-environment node
 *
 * v1.3 (L2 + L3) — PluginHost high-frequency coalescing + PER-KIND
 * interaction gating for wheel + hover events.
 *
 * Wheel and hover ride the SAME rAF coalescing infrastructure L1 built
 * for pointer move (one event per (event-name, target) per frame, drawn
 * from the separate HF budget). The only new behaviour: each kind is
 * gated on its OWN manifest `interaction` sub-flag — wheel on
 * `interaction.wheel`, hover on `interaction.hover` — not on
 * `interaction.pointer`.
 */

import { PluginHost, type MinimalWorker } from '@/plugins/PluginHost'
import {
  type HostToWorker,
  type HostVNodeEvent,
  type WorkerToHost,
} from '@/plugins/protocol'
import type { PluginManifest } from '@/plugins/manifest'

// A view that opted into wheel + hover but NOT pointer, and a panel that
// opted into pointer only — so we can prove the gates are independent.
const manifest: PluginManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  surfaces: {
    fullscreenViews: [
      { id: 'wh', title: 'WheelHover', interaction: { wheel: true, hover: true } },
    ],
    sidebarPanels: [{ id: 'p', title: 'P', interaction: { pointer: true } }],
  },
}

function makeFakeWorker(): { worker: MinimalWorker; sent: HostToWorker[] } {
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

function makeHost(worker: MinimalWorker) {
  let pendingFrame: (() => void) | null = null
  const host = new PluginHost({
    createWorker: () => worker,
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

const vnodeEvents = (sent: HostToWorker[]) =>
  sent.filter((m): m is HostVNodeEvent => m.type === 'host:vnodeEvent')

describe('wheel coalescing + gating', () => {
  test('wheel events on a wheel-opted-in surface coalesce one-per-frame', async () => {
    const fake = makeFakeWorker()
    const { host, flush } = makeHost(fake.worker)
    await host.load({ pluginId: 'demo', pluginSource: '' })
    const source: HostVNodeEvent['source'] = { kind: 'fullscreen', viewId: 'wh' }

    for (let i = 0; i < 8; i++) {
      host.sendVNodeEvent('demo', source, 'zoom', { deltaY: i, target: '' }, {
        highFrequency: true,
        interaction: 'wheel',
      })
    }
    expect(vnodeEvents(fake.sent)).toHaveLength(0)
    flush()
    const delivered = vnodeEvents(fake.sent)
    expect(delivered).toHaveLength(1)
    expect((delivered[0].payload as { deltaY: number }).deltaY).toBe(7)
  })

  test('wheel is dropped when the surface only opted into pointer', async () => {
    const fake = makeFakeWorker()
    const { host, flush, hasPendingFrame } = makeHost(fake.worker)
    await host.load({ pluginId: 'demo', pluginSource: '' })
    // The 'p' panel declared interaction.pointer, NOT interaction.wheel.
    const source: HostVNodeEvent['source'] = { kind: 'panel', panelId: 'p' }
    host.sendVNodeEvent('demo', source, 'zoom', { deltaY: 1 }, {
      highFrequency: true,
      interaction: 'wheel',
    })
    expect(hasPendingFrame()).toBe(false)
    flush()
    expect(vnodeEvents(fake.sent)).toHaveLength(0)
  })
})

describe('hover coalescing + gating', () => {
  test('enter + leave are distinct keys: both survive one frame, latest wins per key', async () => {
    const fake = makeFakeWorker()
    const { host, flush } = makeHost(fake.worker)
    await host.load({ pluginId: 'demo', pluginSource: '' })
    const source: HostVNodeEvent['source'] = { kind: 'fullscreen', viewId: 'wh' }

    host.sendVNodeEvent('demo', source, 'enter', { target: 'n1', x: 1 }, { highFrequency: true, interaction: 'hover' })
    host.sendVNodeEvent('demo', source, 'enter', { target: 'n1', x: 2 }, { highFrequency: true, interaction: 'hover' })
    host.sendVNodeEvent('demo', source, 'leave', { target: 'n1', x: 9 }, { highFrequency: true, interaction: 'hover' })

    flush()
    const delivered = vnodeEvents(fake.sent)
    expect(delivered.map((d) => d.event).sort()).toEqual(['enter', 'leave'])
    const enter = delivered.find((d) => d.event === 'enter')!
    expect((enter.payload as { x: number }).x).toBe(2) // latest enter wins
  })

  test('hover is dropped when the surface only opted into pointer', async () => {
    const fake = makeFakeWorker()
    const { host, flush, hasPendingFrame } = makeHost(fake.worker)
    await host.load({ pluginId: 'demo', pluginSource: '' })
    const source: HostVNodeEvent['source'] = { kind: 'panel', panelId: 'p' }
    host.sendVNodeEvent('demo', source, 'enter', { target: 'n1' }, {
      highFrequency: true,
      interaction: 'hover',
    })
    expect(hasPendingFrame()).toBe(false)
    flush()
    expect(vnodeEvents(fake.sent)).toHaveLength(0)
  })
})
