import { mapWithConcurrency, DEFAULT_CONCURRENCY } from '../utils/concurrency'

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    // Earlier items resolve LATER (descending delays), so completion order is
    // the reverse of input order — the result must still be in input order.
    const items = [0, 1, 2, 3, 4]
    const out = await mapWithConcurrency(items, 2, async (x) => {
      await new Promise((r) => setTimeout(r, (5 - x) * 5))
      return x * 10
    })
    expect(out).toEqual([0, 10, 20, 30, 40])
  })

  it('passes the index to the mapper', async () => {
    const out = await mapWithConcurrency(['a', 'b', 'c'], 8, async (item, idx) => `${item}${idx}`)
    expect(out).toEqual(['a0', 'b1', 'c2'])
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 20 }, (_, i) => i)
    await mapWithConcurrency(items, 4, async (x) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return x
    })
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxInFlight).toBeGreaterThan(1) // proves it actually parallelised
  })

  it('returns an empty array for empty input without invoking fn', async () => {
    const fn = jest.fn(async (x: number) => x)
    const out = await mapWithConcurrency<number, number>([], 8, fn)
    expect(out).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('handles limit larger than the item count', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 100, async (x) => x + 1)
    expect(out).toEqual([2, 3, 4])
  })

  it('clamps a non-positive limit to 1 (does not deadlock)', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 0, async (x) => x * 2)
    expect(out).toEqual([2, 4, 6])
  })

  it('rejects the whole call on the first task rejection', async () => {
    const seen: number[] = []
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => {
        seen.push(x)
        if (x === 2) throw new Error('boom')
        await new Promise((r) => setTimeout(r, 10))
        return x
      }),
    ).rejects.toThrow('boom')
    // After the rejection, workers stop pulling new work — the whole batch is
    // not guaranteed to have been visited.
    expect(seen.length).toBeLessThan(5)
  })

  it('exposes a sane default concurrency constant', () => {
    expect(DEFAULT_CONCURRENCY).toBeGreaterThan(0)
  })
})
