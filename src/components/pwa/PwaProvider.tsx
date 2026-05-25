'use client'

import { useEffect, useState } from 'react'

/*
 * Root-mounted PWA glue. Two jobs, both client-only:
 *
 *   1. Register the service worker (public/sw.js) for offline support.
 *      Gated on production + SW availability so dev/HMR is never disturbed
 *      and unsupported browsers are no-ops. The register() call is app JS,
 *      so Next stamps it with the per-request CSP nonce; sw.js itself is
 *      same-origin and allowed by the `worker-src 'self'` directive.
 *
 *   2. Offer a light, dismissable, one-time install hint:
 *        - Chrome / Android fire `beforeinstallprompt`; we capture it and
 *          surface an "Install" button that calls prompt().
 *        - iOS Safari has no install API, so when running in a normal
 *          Safari tab (not already standalone) we show a one-time tip
 *          pointing at Share -> Add to Home Screen.
 *      Either way the hint shows at most once (tracked in localStorage) and
 *      stays out of the workspace's way (bottom, safe-area aware).
 */

const HINT_DISMISSED_KEY = 'noteser-pwa-install-hint-dismissed'

// Minimal shape of the (non-standard, Chromium-only) beforeinstallprompt event.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIos = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as Mac; detect via touch points.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  // Exclude in-app webviews / other browsers (Chrome on iOS is "CriOS", etc.)
  const isSafari = /^((?!chrome|crios|fxios|edgios|android).)*safari/i.test(ua)
  return isIos && isSafari
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS-specific standalone flag.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function PwaProvider() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosTip, setShowIosTip] = useState(false)

  // Register the service worker (production only).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration failures are non-fatal — the app still runs online */
      })
    }
    // Defer until after load so SW registration never competes with first paint.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])

  // Install affordance (Chrome/Android prompt + iOS tip), one-time.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let dismissed = false
    try {
      dismissed = localStorage.getItem(HINT_DISMISSED_KEY) === '1'
    } catch {
      /* private mode / blocked storage: just show nothing persistent */
    }
    if (dismissed || isStandalone()) return

    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // stop Chrome's default mini-infobar
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // No beforeinstallprompt on iOS Safari — fall back to the manual tip.
    if (isIosSafari()) setShowIosTip(true)

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  const dismiss = () => {
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, '1')
    } catch {
      /* ignore */
    }
    setInstallEvent(null)
    setShowIosTip(false)
  }

  const handleInstall = async () => {
    if (!installEvent) return
    try {
      await installEvent.prompt()
      await installEvent.userChoice
    } catch {
      /* ignore */
    }
    dismiss()
  }

  if (!installEvent && !showIosTip) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[55] flex justify-center px-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-md border border-obsidianBorder bg-obsidianGray px-3 py-2 text-sm text-obsidianText shadow-obsidian">
        {installEvent ? (
          <>
            <span className="min-w-0 flex-1">Install Noteser for offline use.</span>
            <button
              type="button"
              onClick={handleInstall}
              className="flex-none rounded px-2 py-1 text-xs font-medium text-obsidianAccentPurple hover:bg-obsidianHighlight focus:outline-none focus:ring-2 focus:ring-obsidianAccentPurple"
            >
              Install
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1">
            Install: tap Share, then Add to Home Screen.
          </span>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="flex-none rounded p-1 text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText focus:outline-none focus:ring-2 focus:ring-obsidianAccentPurple"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default PwaProvider
