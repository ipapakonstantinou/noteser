// Pure helpers for mobile edge-swipe gesture detection. Used by the
// app shell to decide whether a touchstart → touchend pair should
// toggle the sidebar drawer.
//
// We keep the decision pure (no DOM, no stores) so it's trivially
// testable. The host wires up the actual touchstart/touchend listeners
// and calls toggleSidebar() when these functions return true.

export interface SwipeDetectionOptions {
  edgePx?: number
  minDx?: number
  maxDyRatio?: number
}

const DEFAULTS: Required<SwipeDetectionOptions> = {
  edgePx: 24,
  minDx: 50,
  maxDyRatio: 0.6,
}

// Should we START tracking a potential edge-swipe?
//   - Open gesture: drawer is closed AND the touch started near the
//     left edge of the viewport.
//   - Close gesture: drawer is open — the touch can start anywhere.
// Returns false otherwise (the touch is unrelated to the drawer).
export function shouldTrackSwipe(
  drawerOpen: boolean,
  startX: number,
  opts: SwipeDetectionOptions = {},
): boolean {
  const { edgePx } = { ...DEFAULTS, ...opts }
  if (!drawerOpen) return startX <= edgePx // open-gesture window
  return true                                // close-gesture: anywhere
}

// Given the deltas of a completed swipe and the current drawer state,
// return:
//   'open'   — the user swiped to open the drawer
//   'close'  — the user swiped to close the drawer
//   null     — not a recognized swipe (too short, too vertical, wrong
//              direction for the current drawer state)
export function detectSwipeAction(
  drawerOpen: boolean,
  dx: number,
  dy: number,
  opts: SwipeDetectionOptions = {},
): 'open' | 'close' | null {
  const { minDx, maxDyRatio } = { ...DEFAULTS, ...opts }
  const absDx = Math.abs(dx)
  if (absDx < minDx) return null
  if (Math.abs(dy) > absDx * maxDyRatio) return null // too vertical
  if (!drawerOpen && dx > 0) return 'open'
  if (drawerOpen && dx < 0) return 'close'
  return null
}
