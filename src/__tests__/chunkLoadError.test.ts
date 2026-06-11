/**
 * chunkLoadError.test.ts
 *
 * Unit tests for src/utils/chunkLoadError.ts — stale-deploy chunk failure
 * detection + the single "Reload" toast it surfaces.
 */

import { isChunkLoadError, showChunkReloadToast, CHUNK_RELOAD_MESSAGE } from '../utils/chunkLoadError'
import { useToastStore } from '../stores/toastStore'

// ── isChunkLoadError ─────────────────────────────────────────────────────────

describe('isChunkLoadError', () => {
  test('webpack "Loading chunk N failed" message (the prod bug)', () => {
    expect(
      isChunkLoadError(
        new Error(
          'Loading chunk 5344 failed. (error: https://beta.noteser.app/_next/static/chunks/5344.298763a5a7c2325c.js)',
        ),
      ),
    ).toBe(true)
  })

  test('ChunkLoadError by error name even with terse message', () => {
    const err = new Error('timeout')
    err.name = 'ChunkLoadError'
    expect(isChunkLoadError(err)).toBe(true)
  })

  test('native ESM failures (Chrome/Firefox and Safari wording)', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/y.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
  })

  test('CSS chunk failures', () => {
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed'))).toBe(true)
  })

  test('plain string reasons are matched too (unhandledrejection can carry strings)', () => {
    expect(isChunkLoadError('Loading chunk 7 failed')).toBe(true)
  })

  test('ordinary errors are NOT chunk errors', () => {
    expect(isChunkLoadError(new Error('Sync failed: 409 conflict'))).toBe(false)
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false) // plain offline
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError(42)).toBe(false)
  })
})

// ── showChunkReloadToast ─────────────────────────────────────────────────────

describe('showChunkReloadToast', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  test('adds one sticky error toast with a Reload action', () => {
    showChunkReloadToast()
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].kind).toBe('error')
    expect(toasts[0].message).toBe(CHUNK_RELOAD_MESSAGE)
    expect(toasts[0].actionLabel).toBe('Reload')
    expect(typeof toasts[0].onAction).toBe('function')
  })

  test('repeated chunk failures collapse into a single toast (source dedup)', () => {
    showChunkReloadToast()
    showChunkReloadToast()
    showChunkReloadToast()
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })
})
