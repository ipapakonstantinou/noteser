'use client'

import { useCallback, useRef, useState } from 'react'
import {
  shouldClaimHorizontal,
  shouldCommitPin,
  clampSwipeOffset,
  type PinSwipeOptions,
} from '@/utils/swipePin'

export interface UseSwipePinArgs {
  enabled: boolean
  onCommit: () => void
  options?: PinSwipeOptions
}

interface PointerState {
  id: number
  startX: number
  startY: number
  claimed: boolean
}

// React-glue around the pure swipe-pin helpers. Returns:
//   - bind: spread onto the row's container to wire pointer events.
//   - offset: signed px the host should translate the row (0 when idle).
//   - committing: true for ~150ms after a successful release so the host
//     can paint a confirmation flash, then springs back.
export function useSwipePin({ enabled, onCommit, options }: UseSwipePinArgs) {
  const [offset, setOffset] = useState(0)
  const [committing, setCommitting] = useState(false)
  const stateRef = useRef<PointerState | null>(null)

  const reset = useCallback(() => {
    stateRef.current = null
    setOffset(0)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!enabled) return
    // Ignore non-primary buttons and non-touch/pen pointers; mouse drags
    // would otherwise hijack desktop clicks if the hook were misused.
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    stateRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      claimed: false,
    }
  }, [enabled])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = stateRef.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (!s.claimed) {
      if (!shouldClaimHorizontal(dx, dy, options)) {
        // Still in the tap window or going vertical — let the list
        // scroll. If the user goes too far vertically we abandon the
        // gesture entirely so a later horizontal correction doesn't
        // commit a pin they didn't mean.
        if (Math.abs(dy) > Math.abs(dx) * 2 && Math.abs(dy) > 12) {
          stateRef.current = null
        }
        return
      }
      s.claimed = true
      // Capture the pointer so subsequent move/up land on this element
      // even when the user drags past the row's edge.
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* some test environments lack setPointerCapture */
      }
    }
    if (e.cancelable) e.preventDefault()
    setOffset(clampSwipeOffset(dx, options))
  }, [options])

  const finish = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = stateRef.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    const claimed = s.claimed
    stateRef.current = null
    if (claimed && shouldCommitPin(dx, dy, options)) {
      onCommit()
      setCommitting(true)
      setOffset(0)
      window.setTimeout(() => setCommitting(false), 150)
      return
    }
    setOffset(0)
  }, [onCommit, options])

  const bind = {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: reset,
  }

  return { bind, offset, committing, claimed: stateRef.current?.claimed === true }
}
