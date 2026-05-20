'use client'

import { useEffect, useState } from 'react'

// SSR-safe viewport hook. Returns the current window width + a derived
// isMobile boolean. Defaults to "desktop" during SSR so the server
// markup matches the most common client render — the post-hydration
// effect corrects if needed.
//
// MOBILE_BREAKPOINT mirrors Tailwind's `md` breakpoint (768px) — keeps
// JS-driven layout decisions in lockstep with CSS-driven ones.

export const MOBILE_BREAKPOINT = 768

export interface Viewport {
  width: number
  isMobile: boolean
}

export function useViewport(): Viewport {
  // SSR + first paint assume desktop. Real width comes in via the
  // useEffect below after mount.
  const [vp, setVp] = useState<Viewport>({ width: 1280, isMobile: false })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => {
      const w = window.innerWidth
      setVp({ width: w, isMobile: w <= MOBILE_BREAKPOINT })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return vp
}
