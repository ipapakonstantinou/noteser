'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// App-wide tooltip layer. Replaces the browser's native `title=""` tooltips,
// which are drawn by the OS and are unreliable: they often fail to appear on
// the first hover after the window regains focus (the "alt-tab to fix it"
// symptom in issue #26), need fresh mouse movement to trigger, and won't
// re-show after timing out until the cursor leaves and returns.
//
// Strategy: one component mounted once at the app root. It "adopts" every
// element carrying a `title` attribute — moving the text to a data attribute
// (so the browser stops drawing its own tooltip) and mirroring it to
// `aria-label` when the element has no other accessible name (so screen
// readers keep the label). A MutationObserver keeps adopting titles that React
// adds or changes later. A single delegated hover/focus handler then renders
// our own styled, reliably-positioned tooltip.

const TIP_ATTR = 'data-noteser-tip'
const OPEN_DELAY_MS = 400
const GAP = 8

// Move one element's native `title` into our data attribute, preserving the
// accessible name. Exported for unit testing.
export function adoptTitle(el: Element): void {
  const raw = el.getAttribute('title')
  if (raw === null) return
  el.removeAttribute('title')
  const text = raw.trim()
  if (!text) return
  el.setAttribute(TIP_ATTR, text)
  // Mirror to aria-label ONLY for controls that would otherwise have no
  // accessible name — i.e. icon-only buttons with no visible text. For an
  // element that already shows text, that text IS the accessible name, so we
  // leave it alone rather than override it with the (often longer) tip.
  const hasName =
    el.hasAttribute('aria-label') ||
    el.hasAttribute('aria-labelledby') ||
    (el.textContent ?? '').trim().length > 0
  if (!hasName) {
    el.setAttribute('aria-label', text)
  }
}

function adoptWithin(root: ParentNode): void {
  if (root instanceof Element && root.hasAttribute('title')) adoptTitle(root)
  root.querySelectorAll?.('[title]').forEach(adoptTitle)
}

interface ActiveTip {
  text: string
  anchor: DOMRect
}

export function TooltipLayer() {
  const [tip, setTip] = useState<ActiveTip | null>(null)
  const timerRef = useRef<number | null>(null)
  const currentElRef = useRef<Element | null>(null)

  // 1. Adopt all existing titles on mount, then keep adopting any the app
  //    adds or changes (React re-applies `title` when the prop changes).
  useEffect(() => {
    adoptWithin(document.body)
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (m.target instanceof Element) adoptTitle(m.target)
        } else if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (n instanceof Element) adoptWithin(n)
          })
        }
      }
    })
    obs.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title'],
    })
    return () => obs.disconnect()
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    currentElRef.current = null
    setTip(null)
  }, [clearTimer])

  // 2. Delegated hover / keyboard-focus handling.
  useEffect(() => {
    const tipTarget = (start: EventTarget | null): Element | null => {
      let el = start instanceof Element ? start : null
      while (el) {
        if (el.hasAttribute(TIP_ATTR)) return el
        el = el.parentElement
      }
      return null
    }

    const showFor = (el: Element) => {
      const text = el.getAttribute(TIP_ATTR)
      if (!text) return
      currentElRef.current = el
      setTip({ text, anchor: el.getBoundingClientRect() })
    }

    const onOver = (e: MouseEvent) => {
      const el = tipTarget(e.target)
      if (!el || el === currentElRef.current) return
      clearTimer()
      currentElRef.current = el
      timerRef.current = window.setTimeout(() => {
        // The element may have been removed or moved while we waited.
        if (currentElRef.current !== el || !el.isConnected) return
        showFor(el)
      }, OPEN_DELAY_MS)
    }

    const onOut = (e: MouseEvent) => {
      const from = tipTarget(e.target)
      if (!from) return
      // Ignore moves that stay inside the same tipped element (e.g. onto a
      // child icon). Only hide when truly leaving it.
      if (tipTarget(e.relatedTarget) === from) return
      hide()
    }

    const onFocusIn = (e: FocusEvent) => {
      const el = tipTarget(e.target)
      if (!(el instanceof HTMLElement)) return
      // Keyboard focus only — don't pop a tooltip when a click moves focus.
      let keyboard = true
      try {
        keyboard = el.matches(':focus-visible')
      } catch {
        keyboard = true
      }
      if (keyboard) {
        clearTimer()
        showFor(el)
      }
    }

    const dismiss = () => hide()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', dismiss)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', dismiss, true)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('blur', dismiss)

    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', dismiss)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', dismiss, true)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('blur', dismiss)
      clearTimer()
    }
  }, [clearTimer, hide])

  if (!tip) return null
  return createPortal(<TooltipBubble text={tip.text} anchor={tip.anchor} />, document.body)
}

function TooltipBubble({ text, anchor }: { text: string; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measure the rendered bubble, then place it above the anchor (flipping
  // below when there isn't room) and clamp it inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = anchor.top - height - GAP
    if (top < 4) top = anchor.bottom + GAP
    if (top + height > vh - 4) top = Math.max(4, vh - height - 4)
    let left = anchor.left + anchor.width / 2 - width / 2
    left = Math.min(Math.max(4, left), Math.max(4, vw - width - 4))
    setPos({ left, top })
  }, [text, anchor])

  return (
    <div
      ref={ref}
      role="tooltip"
      className="fixed z-[9999] pointer-events-none select-none max-w-xs rounded-md border border-obsidianBorder bg-obsidianDarkGray px-2 py-1 text-xs leading-snug text-obsidianText shadow-obsidian"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {text}
    </div>
  )
}
