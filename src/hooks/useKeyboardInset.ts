'use client'

import { useEffect, useState } from 'react'

// Pixels between the bottom of the layout viewport and the top of the
// soft keyboard (plus any OS chrome the browser stacks above it: iOS
// Safari's "^ ∨ ✓" input-accessory pill, Chrome Android's autofill row,
// any predictive-text strip). 0 when nothing is open.
//
// Derived from VisualViewport: the layout viewport is the full window,
// the visual viewport is what's painted above the keyboard. The delta
// is the inset that hides anything docked at the layout-viewport bottom.
//
// iOS adds its own input-accessory view ABOVE the visualViewport — that
// pill with prev/next arrows + Done cannot be suppressed from the web.
// To clear it we add a constant guess (~50px) on iOS only. Worst case
// the toolbar sits a few extra pixels higher than strictly necessary,
// which is preferable to it being hidden behind the accessory bar.
//
// Returns 0 below a small jitter threshold so the toolbar doesn't twitch
// for URL-bar collapse animations.
//
// SSR-safe: returns 0 until `useEffect` runs.

const JITTER_THRESHOLD_PX = 80
const IOS_ACCESSORY_BAR_GUESS_PX = 50

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS reports as Mac with touch; covers iPhone + iPad.
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return

    const ios = isIOS()
    const update = () => {
      const raw = window.innerHeight - vv.height - vv.offsetTop
      if (raw <= JITTER_THRESHOLD_PX) {
        setInset(0)
        return
      }
      setInset(raw + (ios ? IOS_ACCESSORY_BAR_GUESS_PX : 0))
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
