// Pure helpers for the mobile drag-to-pin gesture. The host wires up
// pointer events on each note row and calls these to decide whether a
// pointerdown/move/up sequence should trigger a pin/unpin.
//
// Pure (no DOM, no stores) so the threshold logic is unit-testable in
// isolation, mirroring the pattern in edgeSwipe.ts.

export interface PinSwipeOptions {
  // Minimum horizontal travel to commit the action on release.
  triggerPx?: number
  // Below this dx the gesture is treated as a tap; the row click handler
  // still fires.
  tapPx?: number
  // Horizontal-vs-vertical guard: if |dy| exceeds |dx| * this ratio, the
  // gesture is treated as a vertical scroll and the row springs back.
  maxDyRatio?: number
}

const DEFAULTS: Required<PinSwipeOptions> = {
  triggerPx: 60,
  tapPx: 6,
  maxDyRatio: 0.6,
}

// Should the host intercept the move? True once the horizontal delta
// dominates and clears the tap window. The host should also call
// setPointerCapture and event.preventDefault on the first true result so
// the browser stops scrolling the list vertically.
export function shouldClaimHorizontal(
  dx: number,
  dy: number,
  opts: PinSwipeOptions = {},
): boolean {
  const { tapPx, maxDyRatio } = { ...DEFAULTS, ...opts }
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  if (absDx < tapPx) return false
  if (absDy > absDx * maxDyRatio) return false
  return true
}

// Should the release commit the pin/unpin action?
export function shouldCommitPin(
  dx: number,
  dy: number,
  opts: PinSwipeOptions = {},
): boolean {
  const { triggerPx, maxDyRatio } = { ...DEFAULTS, ...opts }
  const absDx = Math.abs(dx)
  if (absDx < triggerPx) return false
  if (Math.abs(dy) > absDx * maxDyRatio) return false
  return true
}

// How far should we visually translate the row given the raw dx? We clip
// the rubber-band at 1.5x the trigger threshold so the user gets feedback
// they've passed the commit point without the row sliding off-screen.
export function clampSwipeOffset(
  dx: number,
  opts: PinSwipeOptions = {},
): number {
  const { triggerPx } = { ...DEFAULTS, ...opts }
  const cap = triggerPx * 1.5
  if (dx > cap) return cap
  if (dx < -cap) return -cap
  return dx
}
