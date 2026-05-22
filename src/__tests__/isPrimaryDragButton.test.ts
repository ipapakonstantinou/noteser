/**
 * isPrimaryDragButton.test.ts
 *
 * Unit tests for the shared primary-button drag guard.
 * The guard is used in 5 components (TabBar, Ribbon, SidebarSection,
 * TabSwitcher, PinnedMiniStrip) to prevent right-click / middle-click
 * from triggering HTML5 drag events.
 */

import { isPrimaryDragButton } from '../utils/isPrimaryDragButton'

describe('isPrimaryDragButton', () => {
  test('returns true for button=0 (primary / left click)', () => {
    expect(isPrimaryDragButton({ nativeEvent: { button: 0 } })).toBe(true)
  })

  test('returns false for button=2 (right-click)', () => {
    expect(isPrimaryDragButton({ nativeEvent: { button: 2 } })).toBe(false)
  })

  test('returns false for button=1 (middle-click)', () => {
    expect(isPrimaryDragButton({ nativeEvent: { button: 1 } })).toBe(false)
  })

  test('returns true when nativeEvent is absent (defensive: treat as primary)', () => {
    expect(isPrimaryDragButton({})).toBe(true)
  })

  test('returns false when nativeEvent.button is undefined (button !== 0 → non-primary)', () => {
    // The guard checks `button !== 0`. undefined !== 0 is true, so this is treated
    // as a non-primary drag — matching the inline component guard semantics.
    expect(isPrimaryDragButton({ nativeEvent: {} })).toBe(false)
  })
})
