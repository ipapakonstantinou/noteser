/**
 * windowListenerCleanup.test.tsx
 *
 * Every window listener a component adds must be removed on unmount, with
 * the same type, handler and capture flag. The Tailwind 4 codemod renamed
 * the event name in `removeEventListener('blur', ...)` to 'blur-sm', which
 * left a 'blur' listener behind on every unmount.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import { render } from '@testing-library/react'

import { SidebarStack } from '../components/sidebar/SidebarStack'
import { RightSidebarStack } from '../components/sidebar/RightSidebarStack'
import { TooltipLayer } from '../components/ui/TooltipLayer'

const capture = (opts: unknown) =>
  typeof opts === 'boolean' ? opts : Boolean((opts as AddEventListenerOptions | undefined)?.capture)

// Window listeners added while `ui` was mounted that its unmount left behind.
function leakedWindowListeners(ui: React.ReactElement): string[] {
  const add = jest.spyOn(window, 'addEventListener')
  const remove = jest.spyOn(window, 'removeEventListener')
  try {
    render(ui).unmount()
    return add.mock.calls
      .filter(([type, fn, opts]) => !remove.mock.calls.some(
        ([t, f, o]) => t === type && f === fn && capture(o) === capture(opts)))
      .map(([type]) => type)
  } finally {
    add.mockRestore()
    remove.mockRestore()
  }
}

describe('window listeners are removed on unmount', () => {
  test('SidebarStack', () => {
    expect(leakedWindowListeners(<SidebarStack onRightClick={jest.fn()} />)).toEqual([])
  })

  test('RightSidebarStack', () => {
    expect(leakedWindowListeners(<RightSidebarStack />)).toEqual([])
  })

  test('TooltipLayer', () => {
    expect(leakedWindowListeners(<TooltipLayer />)).toEqual([])
  })
})
