// Bounded-concurrency map. Runs `fn` over `items` with at most `limit`
// promises in flight at once, returning results in INPUT ORDER (not
// completion order). The first rejection rejects the whole call — callers
// (e.g. the sync pull, wrapped in a try/catch + 45s watchdog) already handle
// failure at a higher level, so we don't swallow errors here.
//
// Why this exists: the first-clone pull fetches hundreds of blobs from the
// GitHub REST API. Doing that sequentially is what blew the sync watchdog;
// fanning out to a small pool keeps wall time bounded without hammering the
// API rate limit (or tripping GitHub's secondary abuse limits the way an
// unbounded Promise.all would).

/** Default in-flight cap for blob fetches. Tunable — kept modest to stay
 *  well under GitHub's secondary rate limits while still cutting wall time. */
export const DEFAULT_CONCURRENCY = 8

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length
  const results = new Array<R>(n)
  if (n === 0) return results
  // A limit <= 0 would deadlock (no worker ever starts); clamp to 1, and
  // never spin up more workers than there are items.
  const workers = Math.max(1, Math.min(limit, n))

  let next = 0
  let failed = false

  async function worker(): Promise<void> {
    // Pull the next index off the shared cursor until the queue is drained.
    // We stop early once any task has rejected — no point starting more work
    // that the caller is going to discard.
    for (;;) {
      if (failed) return
      const idx = next++
      if (idx >= n) return
      try {
        results[idx] = await fn(items[idx], idx)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }

  // Promise.all rejects on the first worker that throws, which is exactly the
  // "first rejection rejects the whole thing" contract we want.
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}
