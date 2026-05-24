import { create } from 'zustand'

// Lightweight, ephemeral toast notifications. NOT persisted — toasts are
// point-in-time feedback (sync finished, sync failed, conflicts pending) and
// must never survive a reload. Rendered once at the app root by <Toaster />.

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  /** Optional action button label (e.g. "Retry"). */
  actionLabel?: string
  /** Invoked when the action button is pressed. The toast is dismissed first. */
  onAction?: () => void
  /**
   * Optional lifecycle category (e.g. `'sync'`). Toasts that share a source
   * supersede one another: callers dismiss the prior toast of a source before
   * adding the next, so at most one is on screen. This is how a successful sync
   * clears the earlier red "Sync timed out…" error toast.
   */
  source?: string
}

// Auto-dismiss delay for success/info toasts. Errors are sticky — they persist
// until the user dismisses them or takes the offered action, so a failed sync
// can't scroll away before the user notices it.
const AUTO_DISMISS_MS = 4_000

interface ToastState {
  toasts: Toast[]
  /** Add a toast. Returns its generated id so callers can dismiss it early. */
  addToast: (toast: Omit<Toast, 'id'>) => string
  /** Remove a toast by id (idempotent — unknown ids are a no-op). */
  dismissToast: (id: string) => void
  /**
   * Remove every toast tagged with `source` (idempotent). Used to keep a
   * single-lifecycle category (e.g. `'sync'`) down to one visible toast: the
   * caller dismisses the prior source toast before adding the next.
   */
  dismissBySource: (source: string) => void
}

// Per-toast auto-dismiss timers, kept outside the store so they don't trigger
// re-renders. Cleared when a toast is dismissed early so we don't fire a stale
// timer against a recycled id.
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function newId(): string {
  // crypto.randomUUID is available in every browser we target and in jsdom;
  // fall back to a timestamp+random for the rare environment that lacks it.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = newId()
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))

    // Success/info auto-dismiss; errors stay until acted on or dismissed.
    if (toast.kind !== 'error') {
      const timer = setTimeout(() => {
        timers.delete(id)
        get().dismissToast(id)
      }, AUTO_DISMISS_MS)
      timers.set(id, timer)
    }
    return id
  },

  dismissToast: (id) => {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  dismissBySource: (source) => {
    const doomed = get().toasts.filter((t) => t.source === source)
    if (doomed.length === 0) return
    for (const t of doomed) {
      const timer = timers.get(t.id)
      if (timer) {
        clearTimeout(timer)
        timers.delete(t.id)
      }
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.source !== source) }))
  },
}))
