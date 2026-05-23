'use client'

import { useEffect, useState } from 'react'
import { useToastStore, type Toast } from '@/stores/toastStore'

// Single root-mounted toast host. Renders the live toast stack bottom-center,
// above the mobile bottom edge (safe-area aware) and over everything else
// (modals included). Each toast carries a message, an optional action button
// (e.g. "Retry"), and a dismiss (×). Motion is intentionally subtle.

const KIND_STYLES: Record<Toast['kind'], string> = {
  // A thin left accent bar keys the toast kind without shouting. The body stays
  // on the dark obsidian palette so toasts read as part of the app chrome.
  info: 'border-l-obsidianAccentPurple',
  success: 'border-l-green-500',
  error: 'border-l-red-500',
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useToastStore((s) => s.dismissToast)
  // Mount with the entered state on the next frame so the CSS transition runs.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const handleAction = () => {
    // Dismiss first so the action (often a retry that re-queues a toast) starts
    // from a clean slate rather than stacking on the toast it replaces.
    dismissToast(toast.id)
    toast.onAction?.()
  }

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
      className={[
        'pointer-events-auto flex items-center gap-3 rounded-md border border-obsidianBorder border-l-4',
        'bg-obsidianGray text-obsidianText shadow-obsidian px-3 py-2 text-sm',
        'transition-all duration-200 ease-out',
        entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
        KIND_STYLES[toast.kind],
      ].join(' ')}
    >
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>

      {toast.actionLabel && (
        <button
          type="button"
          onClick={handleAction}
          className="flex-none rounded px-2 py-1 text-xs font-medium text-obsidianAccentPurple hover:bg-obsidianHighlight focus:outline-none focus:ring-2 focus:ring-obsidianAccentPurple"
        >
          {toast.actionLabel}
        </button>
      )}

      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(toast.id)}
        className="flex-none rounded p-1 text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText focus:outline-none focus:ring-2 focus:ring-obsidianAccentPurple"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4"
      // Sit above the mobile bottom edge / home indicator. The extra 1rem keeps
      // the stack clear of any bottom chrome even on devices without a safe-area
      // inset. pointer-events are re-enabled on each toast so the gaps stay
      // click-through to the editor behind.
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

export default Toaster
