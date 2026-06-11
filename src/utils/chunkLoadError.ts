// Stale-deployment chunk failures. The app is a long-lived SPA: a tab can
// stay open across a deploy, after which the hashed chunk files its build
// manifest points at no longer exist on the CDN. Any lazy import() then
// rejects with webpack's "Loading chunk N failed" (or the browser-native
// ESM equivalent). Retrying the same import can never succeed — the file
// is gone — so the only fix is a full reload to pick up the new manifest.
//
// Reloading is safe at any moment: all vault state persists to
// localStorage/IDB on write, so nothing is lost.

import { useToastStore } from '@/stores/toastStore'

const CHUNK_ERROR_PATTERNS = [
  /loading chunk [\w-]+ failed/i, // webpack JS chunks
  /loading css chunk/i, // webpack CSS chunks
  /chunkloaderror/i, // error.name leaked into a message
  /failed to fetch dynamically imported module/i, // Chrome/Firefox native ESM
  /importing a module script failed/i, // Safari native ESM
]

/** True when `err` is a failed lazy-chunk load (stale deploy), not a code bug. */
export function isChunkLoadError(err: unknown): boolean {
  if (err == null) return false
  const message =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === 'string'
        ? err
        : ''
  return CHUNK_ERROR_PATTERNS.some((p) => p.test(message))
}

export const CHUNK_RELOAD_MESSAGE =
  'Noteser was updated in the background — reload to finish the update.'

const TOAST_SOURCE = 'chunk-reload'

/**
 * Surface a single sticky "reload to update" toast. Deduped via the toast
 * `source` so repeated chunk failures (every lazy import fails after a
 * deploy) collapse into one visible toast.
 */
export function showChunkReloadToast(): void {
  const { dismissBySource, addToast } = useToastStore.getState()
  dismissBySource(TOAST_SOURCE)
  addToast({
    kind: 'error',
    message: CHUNK_RELOAD_MESSAGE,
    source: TOAST_SOURCE,
    actionLabel: 'Reload',
    onAction: () => {
      window.location.reload()
    },
  })
}
