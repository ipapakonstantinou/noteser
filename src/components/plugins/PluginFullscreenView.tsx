'use client'

// Host-side modal that renders the currently-open plugin fullscreen
// view. Plugin API v1.2 PR B per `docs/plugins-v1.2-plan.md` section
// 3.1.
//
// One mount point, one active view at a time. The wire layer in
// `pluginHostSingleton` enforces the single-view invariant; this
// component is the render surface only.
//
// Lifecycle:
//   - Plugin calls ctx.openFullscreen(viewId).
//   - pluginHostSingleton's handleFullscreenOpenRequest writes the
//     view into pluginStore.activeFullscreen + notifies the worker
//     so the plugin's onFullscreenMount fires.
//   - This component subscribes to activeFullscreen and renders the
//     modal. The plugin populates content via setFullscreenContent;
//     the singleton updates the same store slot.
//   - On X click / Esc / closeFullscreen, the store slot is cleared
//     and the worker is notified so onFullscreenUnmount fires.
//
// Focus management:
//   - Esc on document (capture phase per plan section 3.1).
//   - Tab / Shift+Tab wrap inside the modal (focus trap).
//   - Focus snapshot + restore on close (same contract as Modal.tsx).
//   - Body scroll locked while open.
//
// Note focus loss: the modal stays open across active-note changes.
// The plugin is in control (plan section 3.1 + PR B impl notes).

import { useEffect, useRef } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { usePluginStore } from '@/stores/pluginStore'
import {
  dismissActiveFullscreen,
  getPluginHost,
} from '@/plugins/pluginHostSingleton'
import { PluginNode, type PluginVNodeEvent } from '@/plugins/PluginVNode'
import { applySvgPositionPatches } from '@/plugins/svgPositionPatch'

// Same selector approach as Modal.tsx — keep the trap inline rather
// than pulling focus-trap-react for one more mount point.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const getFocusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  )

export const PluginFullscreenView = () => {
  const active = usePluginStore((s) => s.activeFullscreen)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  // Track the active descriptor's identity (pluginId + viewId) so we
  // only re-run focus snapshot logic when the mounted view actually
  // changes, not on every content update.
  const activeKey = active ? `${active.pluginId}:${active.viewId}` : null

  // v1.3 (L4) — position-patch fast path. Subscribe to the host's
  // `svgPositionsPatch` events for the open view and apply them straight
  // to the mounted svg via direct DOM mutation, never re-rendering the
  // VNode tree. Scoped by pluginId + (optional) viewId so a patch for a
  // different surface is ignored.
  const activePluginId = active?.pluginId ?? null
  const activeViewId = active?.viewId ?? null
  useEffect(() => {
    if (!activePluginId) return
    const host = getPluginHost()
    if (!host) return
    return host.on((event) => {
      if (event.type !== 'svgPositionsPatch') return
      if (event.pluginId !== activePluginId) return
      if (event.viewId !== undefined && event.viewId !== activeViewId) return
      applySvgPositionPatches(bodyRef.current, event.patches)
    })
  }, [activePluginId, activeViewId])

  // Esc handler. Capture phase per plan section 3.1 so a plugin's
  // own listeners on a rendered control cannot swallow Esc.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismissActiveFullscreen()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active])

  // Body scroll lock while open. Matches Modal.tsx's contract.
  useEffect(() => {
    if (!active) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [active])

  // Page-unload close. Notify the worker so onFullscreenUnmount fires
  // even when the user navigates away — the plugin should not have
  // to discover that its modal vanished by polling.
  useEffect(() => {
    if (!active) return
    const onUnload = () => {
      // Synchronous; postMessage during pagehide is best-effort but
      // browsers do honour it for short payloads.
      dismissActiveFullscreen()
    }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [active])

  // Focus snapshot + restore + initial focus. Mirrors Modal.tsx so
  // screen readers get the same announcement and keyboard users land
  // back where they started on close.
  useEffect(() => {
    if (!activeKey) return
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    const id = requestAnimationFrame(() => {
      const root = dialogRef.current
      if (!root) return
      const focusables = getFocusable(root)
      const first = focusables[0]
      if (first) first.focus()
      else root.focus()
    })
    return () => {
      cancelAnimationFrame(id)
      const prev = previouslyFocusedRef.current
      if (prev && document.contains(prev)) {
        prev.focus()
      }
    }
  }, [activeKey])

  // Tab trap. Same shape as Modal.tsx.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = getFocusable(root)
      if (focusables.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const cur = document.activeElement as HTMLElement | null
      if (!cur || !root.contains(cur)) {
        e.preventDefault()
        first.focus()
        return
      }
      if (e.shiftKey && cur === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active])

  if (!active) return null

  // VNode event dispatch — forward into the wire protocol with the
  // `fullscreen` source kind PR A pre-shipped. The host queues these
  // via the PluginHost rate limiter and posts them as
  // `host:vnodeEvent` envelopes; the worker routes to whatever the
  // plugin registered via `ctx.onVNodeEvent`. Wired in the
  // "Post-v1.2: VNode event delivery + wikilink intercept" follow-up.
  const handleEvent = (e: PluginVNodeEvent) => {
    const host = getPluginHost()
    if (!host) return
    host.sendVNodeEvent(
      active.pluginId,
      { kind: 'fullscreen', viewId: active.viewId },
      e.event,
      e.payload,
      { highFrequency: e.highFrequency === true, ...(e.interaction ? { interaction: e.interaction } : {}) },
    )
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 9999 }}
      data-testid="plugin-fullscreen-view"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-xs" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-fullscreen-title"
        tabIndex={-1}
        className="relative w-[min(96vw,1200px)] h-[min(96dvh,900px)] bg-obsidianGray rounded-lg shadow-obsidian border border-obsidianBorder flex flex-col focus:outline-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-obsidianBorder shrink-0">
          <div className="flex flex-col">
            <h2
              id="plugin-fullscreen-title"
              className="text-lg font-medium text-obsidianText"
            >
              {active.title}
            </h2>
            <span className="text-[11px] uppercase tracking-wide text-obsidianSecondaryText">
              {active.pluginName}
            </span>
          </div>
          <button
            onClick={() => dismissActiveFullscreen()}
            className="p-1 rounded-sm hover:bg-obsidianHighlight transition-colors"
            aria-label="Close fullscreen view"
            data-testid="plugin-fullscreen-close"
          >
            <XMarkIcon className="w-5 h-5 text-obsidianSecondaryText" />
          </button>
        </div>

        <div
          ref={bodyRef}
          className="flex-1 min-h-0 overflow-auto p-4 text-sm text-obsidianText"
          data-testid="plugin-fullscreen-body"
        >
          {active.node === null || active.node === undefined ? (
            <span className="text-obsidianSecondaryText">
              Loading view content...
            </span>
          ) : (
            <PluginNode node={active.node} onEvent={handleEvent} />
          )}
        </div>
      </div>
    </div>
  )
}

export default PluginFullscreenView
