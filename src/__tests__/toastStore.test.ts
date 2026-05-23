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
})
