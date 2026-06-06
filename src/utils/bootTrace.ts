// Tiny boot-timeline tracer. iOS Safari has a watchdog that kills any
// task whose main-thread work runs longer than a few seconds; the
// instinct on debugging that is to cargo-cult `setTimeout(..., 0)`
// everywhere. The right move is to MEASURE where the boot path
// actually spends its time, then break up only the offenders.
//
// Usage:
//   bootMark('plugin-bootstrap:start')
//   ...work...
//   bootMark('plugin-bootstrap:end')
//   // optionally:
//   bootMeasure('plugin-bootstrap', 'plugin-bootstrap:start', 'plugin-bootstrap:end')
//
// Tracer + console output are both dev-only (NODE_ENV !== 'production'),
// so shipping a bootMark call costs ~1 conditional in prod.
//
// We also expose `yieldToMain()` which returns a Promise that resolves
// after the browser gets a chance to paint / process input. Built on
// the Scheduler API (Chrome / Edge / Safari 18+) with a setTimeout
// fallback. The yield is what lets us break a long loop into chunks
// the iOS watchdog will not kill.

const PREFIX = 'noteser-boot:'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof performance !== 'undefined'
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export function bootMark(name: string): void {
  if (!isBrowser()) return
  try {
    performance.mark(PREFIX + name)
  } catch {
    /* mark name already used in this session — fine, ignore */
  }
}

export function bootMeasure(
  label: string,
  startMark: string,
  endMark: string,
): number | null {
  if (!isBrowser()) return null
  try {
    const m = performance.measure(
      PREFIX + label,
      PREFIX + startMark,
      PREFIX + endMark,
    )
    if (isDev()) {
      console.info(`[boot] ${label}: ${m.duration.toFixed(1)}ms`)
    }
    return m.duration
  } catch {
    return null
  }
}

// Yield control back to the browser. iOS Safari's watchdog measures
// per-task wall time; a single await on this Promise resets the clock.
// We try Scheduler.postTask (Chrome) first, fall back to a 0ms timeout.
export function yieldToMain(): Promise<void> {
  if (!isBrowser()) return Promise.resolve()
  const scheduler = (globalThis as unknown as {
    scheduler?: { postTask?: (cb: () => void, opts?: { priority?: string }) => Promise<void> }
  }).scheduler
  if (scheduler && typeof scheduler.postTask === 'function') {
    return scheduler.postTask(() => undefined, { priority: 'user-visible' })
  }
  return new Promise(resolve => setTimeout(resolve, 0))
}

// Break a long synchronous loop into watchdog-safe chunks. Calls
// `fn(item)` for each entry, then yields to main every ~30ms. Returns
// when the array is fully processed.
//
// The yield budget is conservative: iOS kills tasks measured against
// the worker thread, but the visible jank threshold is ~50ms, so 30ms
// keeps the UI responsive AND stays well under any watchdog window.
export async function forEachWithYield<T>(
  items: readonly T[],
  fn: (item: T, index: number) => void | Promise<void>,
  budgetMs = 30,
): Promise<void> {
  if (!isBrowser()) {
    for (let i = 0; i < items.length; i++) await fn(items[i], i)
    return
  }
  let start = performance.now()
  for (let i = 0; i < items.length; i++) {
    await fn(items[i], i)
    if (performance.now() - start > budgetMs) {
      await yieldToMain()
      start = performance.now()
    }
  }
}
