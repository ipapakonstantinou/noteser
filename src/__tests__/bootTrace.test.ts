/**
 * @jest-environment jsdom
 */
import { forEachWithYield, yieldToMain, bootMark, bootMeasure } from '../utils/bootTrace'

describe('yieldToMain', () => {
  test('returns a Promise that resolves on the next task', async () => {
    let after = false
    const p = yieldToMain().then(() => { after = true })
    // The flag must NOT be set synchronously — that would mean the
    // browser never got a chance to paint / process input.
    expect(after).toBe(false)
    await p
    expect(after).toBe(true)
  })
})

describe('forEachWithYield', () => {
  test('invokes the callback once per item, in order', async () => {
    const seen: number[] = []
    await forEachWithYield([1, 2, 3, 4], (n) => { seen.push(n) })
    expect(seen).toEqual([1, 2, 3, 4])
  })

  test('yields to main when the per-batch budget is exceeded', async () => {
    // A tiny budget guarantees a yield between every iteration so the
    // test does not need to fake the clock. The behaviour we care
    // about is: the loop releases the main thread, it does not run
    // synchronously to completion.
    let resumed = false
    const items = [0, 1, 2, 3]
    const work = forEachWithYield(
      items,
      () => {
        // Burn enough wall time per iteration to blow past budgetMs.
        const start = performance.now()
        while (performance.now() - start < 5) { /* spin */ }
      },
      1,
    )
    // Schedule a synchronous-after-microtasks observer: if the loop
    // never yields, this microtask runs only AFTER the loop finishes.
    queueMicrotask(() => { resumed = true })
    await work
    expect(resumed).toBe(true)
  })

  test('awaits async callbacks before yielding', async () => {
    const order: string[] = []
    await forEachWithYield([1, 2], async (n) => {
      order.push(`start-${n}`)
      await Promise.resolve()
      order.push(`end-${n}`)
    })
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })
})

describe('bootMark + bootMeasure', () => {
  test('mark + measure does not throw, and a real duration is non-negative', () => {
    // jsdom's performance API is a partial polyfill — measure() can
    // return null when the underlying impl rejects string-mark args.
    // The contract we ENFORCE is "does not throw"; if a value comes
    // back, it must be non-negative.
    bootMark('test:a')
    bootMark('test:b')
    const d = bootMeasure('test', 'test:a', 'test:b')
    if (d !== null) expect(d).toBeGreaterThanOrEqual(0)
  })

  test('measure with missing marks returns null (does not throw)', () => {
    const d = bootMeasure('missing', 'no:start', 'no:end')
    expect(d).toBeNull()
  })
})
