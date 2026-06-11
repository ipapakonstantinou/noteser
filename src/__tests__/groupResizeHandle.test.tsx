/**
 * groupResizeHandle.test.tsx
 *
 * The GroupResizeHandle is the horizontal divider the user drags to
 * trade height between two stacked sidebar groups (backlog #36 — sidebar
 * sections were collapse-only and squeezed the file tree). These tests
 * cover the interactive paths:
 *   - mouse drag trades height between the pair and clamps at the minimum
 *   - arrow-key resize (accessibility) nudges the boundary and clamps
 *   - Home / End push the boundary to either extreme
 *   - double-click releases both heights back to flex distribution
 *   - the ARIA separator contract (role/orientation/valuenow range)
 *
 * The component is presentational — it emits (above, below) pairs via
 * onResize and never touches a store — so these tests assert on the
 * callback arguments directly.
 *
 * #177 adds touch parity: the same drag must work with a finger because
 * the sidebar stack also renders inside the mobile drawer. The touch
 * suite mirrors the mouse one (touchstart on the handle, window-level
 * touchmove/touchend) so the two input paths can't drift apart.
 */

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { GroupResizeHandle } from '../components/sidebar/GroupResizeHandle'
import { MIN_GROUP_HEIGHT } from '../stores/settingsStore'

const getHandle = () => screen.getByTestId('sidebar-group-resize-handle')

// A roomy pair so the default 16px / 64px steps stay clear of the
// MIN_GROUP_HEIGHT floor unless a test deliberately pushes into it.
const ABOVE = 200
const BELOW = 200
const TOTAL = ABOVE + BELOW

function renderHandle(overrides: Partial<React.ComponentProps<typeof GroupResizeHandle>> = {}) {
  const onResize = jest.fn()
  const onReset = jest.fn()
  render(
    <GroupResizeHandle
      aboveHeight={ABOVE}
      belowHeight={BELOW}
      onResize={onResize}
      onReset={onReset}
      {...overrides}
    />,
  )
  return { onResize, onReset }
}

describe('GroupResizeHandle — ARIA', () => {
  test('exposes a horizontal separator with the pair height range', () => {
    renderHandle()
    const handle = getHandle()
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    expect(handle).toHaveAttribute('aria-valuenow', String(ABOVE))
    expect(handle).toHaveAttribute('aria-valuemin', String(MIN_GROUP_HEIGHT))
    // Max = whole budget minus the floor reserved for the lower group.
    expect(handle).toHaveAttribute('aria-valuemax', String(TOTAL - MIN_GROUP_HEIGHT))
    expect(handle).toHaveAttribute('tabindex', '0')
  })
})

describe('GroupResizeHandle — mouse drag', () => {
  test('dragging down grows the group above and shrinks the one below', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.mouseDown(handle, { button: 0, clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 150 }) // +50px down
    expect(onResize).toHaveBeenLastCalledWith(ABOVE + 50, BELOW - 50)

    fireEvent.mouseUp(window)
  })

  test('dragging far up clamps the upper group at the minimum', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.mouseDown(handle, { button: 0, clientY: 100 })
    fireEvent.mouseMove(window, { clientY: -9999 }) // way past the top
    expect(onResize).toHaveBeenLastCalledWith(MIN_GROUP_HEIGHT, TOTAL - MIN_GROUP_HEIGHT)
    fireEvent.mouseUp(window)
  })

  test('a right-button mousedown does not start a drag', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.mouseDown(handle, { button: 2, clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 300 })
    expect(onResize).not.toHaveBeenCalled()
  })

  test('mouse move after release does not keep resizing', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.mouseDown(handle, { button: 0, clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 120 })
    fireEvent.mouseUp(window)
    const callsAfterRelease = onResize.mock.calls.length
    fireEvent.mouseMove(window, { clientY: 400 })
    expect(onResize.mock.calls.length).toBe(callsAfterRelease)
  })
})

describe('GroupResizeHandle — touch drag (#177)', () => {
  test('touch-dragging down grows the group above and shrinks the one below', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(window, { touches: [{ clientY: 160 }] }) // +60px down
    expect(onResize).toHaveBeenLastCalledWith(ABOVE + 60, BELOW - 60)

    fireEvent.touchEnd(window)
  })

  test('touch-dragging far up clamps the upper group at the minimum', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(window, { touches: [{ clientY: -9999 }] })
    expect(onResize).toHaveBeenLastCalledWith(MIN_GROUP_HEIGHT, TOTAL - MIN_GROUP_HEIGHT)
    fireEvent.touchEnd(window)
  })

  test('touch move after touchend does not keep resizing', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(window, { touches: [{ clientY: 130 }] })
    fireEvent.touchEnd(window)
    const callsAfterRelease = onResize.mock.calls.length
    fireEvent.touchMove(window, { touches: [{ clientY: 300 }] })
    expect(onResize.mock.calls.length).toBe(callsAfterRelease)
  })

  test('touchcancel ends the drag like touchend', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] })
    fireEvent.touchCancel(window)
    fireEvent.touchMove(window, { touches: [{ clientY: 300 }] })
    expect(onResize).not.toHaveBeenCalled()
  })

  test('the handle opts out of browser touch scrolling (touch-action none)', () => {
    renderHandle()
    // Tailwind `touch-none` → touch-action: none. Without it the browser
    // would claim the vertical gesture for scrolling the stack.
    expect(getHandle().className).toContain('touch-none')
  })
})

describe('GroupResizeHandle — keyboard', () => {
  test('ArrowDown / ArrowUp nudge the boundary by the step', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onResize).toHaveBeenLastCalledWith(ABOVE + 16, BELOW - 16)

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onResize).toHaveBeenLastCalledWith(ABOVE - 16, BELOW + 16)
  })

  test('Shift+Arrow takes a larger step', () => {
    const { onResize } = renderHandle()
    fireEvent.keyDown(getHandle(), { key: 'ArrowDown', shiftKey: true })
    expect(onResize).toHaveBeenLastCalledWith(ABOVE + 64, BELOW - 64)
  })

  test('Home / End push the boundary to either extreme', () => {
    const { onResize } = renderHandle()
    const handle = getHandle()

    fireEvent.keyDown(handle, { key: 'End' })
    expect(onResize).toHaveBeenLastCalledWith(TOTAL - MIN_GROUP_HEIGHT, MIN_GROUP_HEIGHT)

    fireEvent.keyDown(handle, { key: 'Home' })
    expect(onResize).toHaveBeenLastCalledWith(MIN_GROUP_HEIGHT, TOTAL - MIN_GROUP_HEIGHT)
  })

  test('an unrelated key is ignored', () => {
    const { onResize } = renderHandle()
    fireEvent.keyDown(getHandle(), { key: 'a' })
    expect(onResize).not.toHaveBeenCalled()
  })
})

describe('GroupResizeHandle — double-click reset', () => {
  test('double-click releases both heights', () => {
    const { onReset } = renderHandle()
    fireEvent.doubleClick(getHandle())
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
