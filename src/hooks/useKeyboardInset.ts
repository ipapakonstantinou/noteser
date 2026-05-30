'use client'

import { useEffect, useState } from 'react'

// Pixels between the bottom of the layout viewport and the top of the
// visual viewport when the soft keyboard is open. 0 when closed.
//
// `window.innerHeight - visualViewport.height - visualViewport.offsetTop`
// gives the inset directly. iOS Safari and Chrome Android both already
// subtract their input-accessory chrome (the "^ ∨ ✓" pill, the autofill
// row) from visualViewport.height, so the raw value is what we want —
// no per-platform offset, no double-counting.
//
// Earlier revision added an iOS-only +50px constant on the assumption
// that the accessory pill overlaid visualViewport. Testing on Jon's
// iPhone showed the opposite: the constant lifts the bar so high it
// floats well above the keyboard with a visible gap. Dropped.
//
// Returns 0 below a small jitter threshold so the bar doesn't twitch for
// URL-bar collapse animations.
//
// SSR-safe: returns 0 until `useEffect` runs.

const JITTER_THRESHOLD_PX = 80

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const raw = window.innerHeight - vv.height - vv.offsetTop
      setInset(raw > JITTER_THRESHOLD_PX ? raw : 0)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
