'use client'

import { useEffect, useRef, useState } from 'react'
import {
  shouldPromptForUpdate,
  shouldReloadOnControllerChange,
} from '@/utils/swUpdate'

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
  // A waiting SW that the user can activate via the "Reload" prompt.
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  // Latched once we trigger the reload so a second controllerchange can't loop.
  const reloadedRef = useRef(false)

  // Register the service worker (production only) and wire up the update flow.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const sw = navigator.serviceWorker
    // Per-build id so the registration URL changes every deploy → the browser
    // detects and installs the new SW (the committed sw.js bytes don't change).
    const buildId = process.env.NEXT_PUBLIC_BUILD_ID || 'dev'
    const swUrl = `/sw.js?v=${encodeURIComponent(buildId)}`

    let cleanupReg: (() => void) | undefined

    // When a waiting worker activates it fires controllerchange; reload ONCE so
    // the page picks up the new build. Guarded against reload loops.
    const onControllerChange = () => {
      if (!shouldReloadOnControllerChange(reloadedRef.current)) return
      reloadedRef.current = true
      window.location.reload()
    }
    sw.addEventListener('controllerchange', onControllerChange)

    const register = () => {
      sw.register(swUrl)
        .then((reg) => {
          // Consider a check for updates promptly on load and whenever the tab
          // regains focus, so a fresh deploy is noticed without a full restart.
          const checkForUpdate = () => {
            reg.update().catch(() => {
              /* offline / transient — try again on next focus */
            })
          }
          checkForUpdate()

          const onVisible = () => {
            if (document.visibilityState === 'visible') checkForUpdate()
          }
          document.addEventListener('visibilitychange', onVisible)
          window.addEventListener('focus', checkForUpdate)
          // Backstop for long-lived sessions that never lose focus.
          const interval = window.setInterval(checkForUpdate, 60 * 60 * 1000)

          // An already-waiting worker (installed before this tab loaded) is an
          // update we should surface immediately.
          if (reg.waiting && navigator.serviceWorker.controller) {
            setWaitingWorker(reg.waiting)
          }

          // A new worker is installing — watch it reach 'installed'. Only an
          // UPDATE (a controller already exists) warrants the reload prompt;
          // the very first install activates quietly.
          const onUpdateFound = () => {
            const installing = reg.installing
            if (!installing) return
            installing.addEventListener('statechange', () => {
              if (
                shouldPromptForUpdate(
                  installing.state,
                  Boolean(navigator.serviceWorker.controller),
                )
              ) {
                setWaitingWorker(reg.waiting ?? installing)
              }
            })
          }
          reg.addEventListener('updatefound', onUpdateFound)

          cleanupReg = () => {
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('focus', checkForUpdate)
            window.clearInterval(interval)
            reg.removeEventListener('updatefound', onUpdateFound)
          }
        })
        .catch(() => {
          /* registration failures are non-fatal — the app still runs online */
        })
    }
    // Defer until after load so SW registration never competes with first paint.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })

    return () => {
      sw.removeEventListener('controllerchange', onControllerChange)
      cleanupReg?.()
    }
  }, [])

  // User accepted the update: ask the waiting worker to take over. Its
  // activation fires controllerchange, which reloads the page exactly once.
  const handleReload = () => {
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' })
  }

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

  const showUpdate = waitingWorker !== null
  if (!installEvent && !showIosTip && !showUpdate) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[55] flex flex-col items-center gap-2 px-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      {/* Update-available prompt: quiet, dismissable, non-blocking. */}
      {showUpdate && (
        <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-md border border-obsidianBorder bg-obsidianGray px-3 py-2 text-sm text-obsidianText shadow-obsidian">
          <span className="min-w-0 flex-1">New version available.</span>
          <button
            type="button"
            onClick={handleReload}
            className="flex-none rounded px-2 py-1 text-xs font-medium text-obsidianAccentPurple hover:bg-obsidianHighlight focus:outline-none focus:ring-2 focus:ring-obsidianAccentPurple"
          >
            Reload
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setWaitingWorker(null)}
            className="flex-none rounded p-1 text-obsidianSecondaryText hover:bg-obsidianHighlight hover:text-obsidianText focus:outline-none focus:ring-2 focus:ring-obsidianAccentPurple"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Install hint (Chrome/Android prompt + iOS tip). */}
      {(installEvent || showIosTip) && (
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
      )}
    </div>
  )
}

export default PwaProvider
