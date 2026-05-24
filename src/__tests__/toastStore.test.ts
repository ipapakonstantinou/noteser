/**
 * toastStore.test.ts
 *
 * The ephemeral toast queue: add returns an id, success/info auto-dismiss after
 * the timeout, errors persist until acted on, and dismiss removes by id.
 */

import { useToastStore } from '../stores/toastStore'

function reset() {
  // Drain any toasts left from a prior test so each starts clean.
  const { toasts, dismissToast } = useToastStore.getState()
  for (const t of toasts) dismissToast(t.id)
}

describe('toastStore', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    reset()
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('addToast returns an id and appends the toast', () => {
    const id = useToastStore.getState().addToast({ kind: 'info', message: 'hi' })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ id, kind: 'info', message: 'hi' })
  })

  test('success toasts auto-dismiss after the timeout', () => {
    useToastStore.getState().addToast({ kind: 'success', message: 'done' })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    // Just before the 4s auto-dismiss it is still present.
    jest.advanceTimersByTime(3_999)
    expect(useToastStore.getState().toasts).toHaveLength(1)

    // After the timeout it is gone.
    jest.advanceTimersByTime(2)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  test('error toasts persist (no auto-dismiss)', () => {
    useToastStore.getState().addToast({ kind: 'error', message: 'boom' })
    jest.advanceTimersByTime(60_000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].kind).toBe('error')
  })

  test('dismissToast removes a toast by id', () => {
    const id = useToastStore.getState().addToast({ kind: 'info', message: 'x' })
    const other = useToastStore.getState().addToast({ kind: 'info', message: 'y' })
    useToastStore.getState().dismissToast(id)
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].id).toBe(other)
  })

  test('dismissToast on an unknown id is a no-op', () => {
    useToastStore.getState().addToast({ kind: 'error', message: 'keep' })
    useToastStore.getState().dismissToast('does-not-exist')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  // ── source-tagged toasts supersede one another ─────────────────────────────
  // A successful sync must clear the earlier "Sync timed out…" error toast
  // (which, being an error, never auto-dismisses). dismissBySource is the
  // mechanism: tag both with source 'sync', drop the prior before adding next.

  test('dismissBySource removes every toast with that source', () => {
    useToastStore.getState().addToast({ kind: 'error', message: 'old', source: 'sync' })
    useToastStore.getState().addToast({ kind: 'info', message: 'other', source: 'other' })
    useToastStore.getState().dismissBySource('sync')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('other')
  })

  test('a sync success toast supersedes a prior sync error toast', () => {
    // The error toast persists (no auto-dismiss).
    useToastStore.getState().addToast({
      kind: 'error', message: 'Sync timed out — check your connection and retry.', source: 'sync',
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    // Adding the next sync toast = dismiss prior source 'sync', then add.
    useToastStore.getState().dismissBySource('sync')
    useToastStore.getState().addToast({ kind: 'success', message: '↓692 new · ↓173 images', source: 'sync' })

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ kind: 'success', message: '↓692 new · ↓173 images', source: 'sync' })
  })

  test('a sync error toast supersedes a prior sync success toast', () => {
    useToastStore.getState().addToast({ kind: 'success', message: 'Up to date', source: 'sync' })
    useToastStore.getState().dismissBySource('sync')
    useToastStore.getState().addToast({ kind: 'error', message: 'Sync failed', source: 'sync' })

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ kind: 'error', message: 'Sync failed' })
  })

  test('dismissBySource leaves non-matching (untagged + other-source) toasts untouched', () => {
    useToastStore.getState().addToast({ kind: 'info', message: 'no source' })
    useToastStore.getState().addToast({ kind: 'info', message: 'export done', source: 'export' })
    useToastStore.getState().addToast({ kind: 'error', message: 'sync boom', source: 'sync' })

    useToastStore.getState().dismissBySource('sync')
    const messages = useToastStore.getState().toasts.map((t) => t.message).sort()
    expect(messages).toEqual(['export done', 'no source'])
  })

  test('dismissBySource on an unused source is a no-op', () => {
    useToastStore.getState().addToast({ kind: 'info', message: 'keep' })
    useToastStore.getState().dismissBySource('nope')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })
})
