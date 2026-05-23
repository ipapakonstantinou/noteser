import { shouldTrackSwipe, detectSwipeAction } from '../utils/edgeSwipe'

describe('shouldTrackSwipe', () => {
  test('drawer closed + touch near left edge → track', () => {
    expect(shouldTrackSwipe(false, 5)).toBe(true)
    expect(shouldTrackSwipe(false, 24)).toBe(true)
  })

  test('drawer closed + touch past edge → ignore', () => {
    expect(shouldTrackSwipe(false, 25)).toBe(false)
    expect(shouldTrackSwipe(false, 200)).toBe(false)
  })

  test('drawer open → always track (close-gesture can start anywhere)', () => {
    expect(shouldTrackSwipe(true, 5)).toBe(true)
    expect(shouldTrackSwipe(true, 300)).toBe(true)
  })

  test('edgePx override is honored', () => {
    expect(shouldTrackSwipe(false, 40, { edgePx: 50 })).toBe(true)
    expect(shouldTrackSwipe(false, 60, { edgePx: 50 })).toBe(false)
  })
})

describe('detectSwipeAction', () => {
  test('rightward swipe past threshold while closed → open', () => {
    expect(detectSwipeAction(false, 80, 5)).toBe('open')
  })

  test('leftward swipe past threshold while open → close', () => {
    expect(detectSwipeAction(true, -80, 5)).toBe('close')
  })

  test('short swipe ignored regardless of direction', () => {
    expect(detectSwipeAction(false, 30, 0)).toBeNull()
    expect(detectSwipeAction(true, -30, 0)).toBeNull()
  })

  test('mostly-vertical swipe ignored (scroll gesture)', () => {
    expect(detectSwipeAction(false, 80, 100)).toBeNull()
    expect(detectSwipeAction(true, -80, 100)).toBeNull()
  })

  test('wrong-direction swipe ignored', () => {
    // Drawer closed but the user swiped LEFT → nothing to close.
    expect(detectSwipeAction(false, -80, 5)).toBeNull()
    // Drawer open but the user swiped RIGHT → already open.
    expect(detectSwipeAction(true, 80, 5)).toBeNull()
  })

  test('boundary: exactly minDx still counts', () => {
    expect(detectSwipeAction(false, 50, 0)).toBe('open')
  })
})
