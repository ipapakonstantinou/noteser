import {
  shouldClaimHorizontal,
  shouldCommitPin,
  clampSwipeOffset,
} from '../utils/swipePin'

describe('shouldClaimHorizontal', () => {
  test('rejects tiny movement inside the tap window', () => {
    expect(shouldClaimHorizontal(2, 0)).toBe(false)
    expect(shouldClaimHorizontal(-3, 1)).toBe(false)
  })

  test('claims a clear horizontal drag past the tap window', () => {
    expect(shouldClaimHorizontal(20, 4)).toBe(true)
    expect(shouldClaimHorizontal(-30, 5)).toBe(true)
  })

  test('rejects diagonal drags dominated by vertical', () => {
    // dy > dx * 0.6 → vertical scroll, not a swipe.
    expect(shouldClaimHorizontal(20, 50)).toBe(false)
    expect(shouldClaimHorizontal(-20, -50)).toBe(false)
  })

  test('honors override options', () => {
    expect(shouldClaimHorizontal(15, 0, { tapPx: 20 })).toBe(false)
    expect(shouldClaimHorizontal(15, 0, { tapPx: 10 })).toBe(true)
  })
})

describe('shouldCommitPin', () => {
  test('rejects deltas below the trigger threshold', () => {
    expect(shouldCommitPin(40, 0)).toBe(false)
    expect(shouldCommitPin(-59, 0)).toBe(false)
  })

  test('commits when the delta crosses the threshold (either direction)', () => {
    expect(shouldCommitPin(60, 0)).toBe(true)
    expect(shouldCommitPin(80, 10)).toBe(true)
    expect(shouldCommitPin(-100, 0)).toBe(true)
  })

  test('rejects commits when the swipe is too vertical', () => {
    expect(shouldCommitPin(80, 70)).toBe(false)
  })

  test('honors a custom threshold', () => {
    expect(shouldCommitPin(70, 0, { triggerPx: 100 })).toBe(false)
    expect(shouldCommitPin(110, 0, { triggerPx: 100 })).toBe(true)
  })
})

describe('clampSwipeOffset', () => {
  test('passes small values through unchanged', () => {
    expect(clampSwipeOffset(10)).toBe(10)
    expect(clampSwipeOffset(-25)).toBe(-25)
    expect(clampSwipeOffset(0)).toBe(0)
  })

  test('caps at 1.5x trigger threshold (default 60 → cap 90)', () => {
    expect(clampSwipeOffset(150)).toBe(90)
    expect(clampSwipeOffset(-150)).toBe(-90)
  })

  test('cap scales with options.triggerPx', () => {
    expect(clampSwipeOffset(500, { triggerPx: 100 })).toBe(150)
  })
})
