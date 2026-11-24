/**
 * groupLayout.test.tsx
 *
 * Among the expanded groups of a sidebar stack exactly one fills the
 * leftover height. A handle drag writes px heights for BOTH neighbours, so
 * a two-group stack used to end up all-fixed: nobody filled, and a taller
 * window left dead space under the last group (the file tree stopped
 * half way down the sidebar).
 *
 * jsdom has no layout, so these assert the layout contract (flex-1, no
 * inline height); e2e/parity/sidebar-last-group-fills.spec.ts measures it.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { SidebarStack } from '../components/sidebar/SidebarStack'
import { RightSidebarStack } from '../components/sidebar/RightSidebarStack'
import { groupLayoutModes } from '../components/sidebar/groupLayout'
import { useSettingsStore, type SidebarGroupState } from '../stores/settingsStore'

const group = (id: string, height: number | null, collapsed = false): SidebarGroupState =>
  ({ id, tabs: [], activeTab: null, collapsed, height })

describe('groupLayoutModes', () => {
  test('all expanded groups sized (any past handle drag): the last one fills', () => {
    expect(groupLayoutModes([group('a', 300), group('b', 200)], {})).toEqual(['fixed', 'fill'])
    expect(groupLayoutModes([group('a', 300), group('b', 200), group('c', 100)], {}))
      .toEqual(['fixed', 'fixed', 'fill'])
  })

  test('an unsized last group fills', () => {
    expect(groupLayoutModes([group('a', 300), group('b', null)], {})).toEqual(['fixed', 'fill'])
  })

  test('an unsized group above a sized last group fills (existing preference kept)', () => {
    expect(groupLayoutModes([group('a', null), group('b', 200)], {})).toEqual(['fill', 'fixed'])
  })

  test('collapsed groups are never the fill target', () => {
    expect(groupLayoutModes([group('a', 300), group('b', 200, true)], {})).toEqual(['fill', 'fixed'])
    expect(groupLayoutModes([group('a', null), group('b', null, true)], {})).toEqual(['fill', 'auto'])
    expect(groupLayoutModes([group('a', 300, true), group('b', null, true)], {})).toEqual(['fixed', 'auto'])
  })

  test('in-flight drafts count as sized', () => {
    const two = [group('a', null), group('b', null)]
    expect(groupLayoutModes(two, { a: 300 })).toEqual(['fixed', 'fill'])
    // Mid-drag both neighbours carry a draft: the last still fills.
    expect(groupLayoutModes(two, { a: 300, b: 200 })).toEqual(['fixed', 'fill'])
    const three = [group('a', null), group('b', null), group('c', null)]
    expect(groupLayoutModes(three, { b: 300, c: 200 })).toEqual(['fill', 'fixed', 'fixed'])
  })

  test('exactly one expanded group fills, for every mix of height / draft / collapsed', () => {
    // Each group: sized by height?, sized by draft?, collapsed? -> 8 states.
    const states = [0, 1, 2, 3, 4, 5, 6, 7]
    for (const s1 of states) for (const s2 of states) for (const s3 of states) {
      const groups = [s1, s2, s3].map((s, i) => group(`g${i}`, s & 1 ? 120 : null, Boolean(s & 4)))
      const drafts: Record<string, number> = {}
      ;[s1, s2, s3].forEach((s, i) => { if (s & 2) drafts[`g${i}`] = 90 })
      const modes = groupLayoutModes(groups, drafts)
      const fills = modes.flatMap((m, i) => (m === 'fill' ? [i] : []))
      const expanded = groups.filter(g => !g.collapsed).length
      expect(fills).toHaveLength(expanded > 0 ? 1 : 0)
      fills.forEach(i => expect(groups[i].collapsed).toBe(false))
    }
  })
})

// The group is a flex item of the stack itself: it must flex-grow and
// carry no inline height (it would win over flex-1).
function expectFills(el: HTMLElement) {
  expect(el.style.height).toBe('')
  expect(el).toHaveClass('flex-1')
  expect(el.parentElement).toHaveAttribute('data-testid', expect.stringMatching(/sidebar-stack$/))
}

describe('SidebarStack: the last expanded group fills the stack', () => {
  const seed = (heights: [number | null, number | null]) =>
    useSettingsStore.setState({
      sidebarGroups: [
        { ...group('g1', heights[0]), tabs: ['calendar'], activeTab: 'calendar' },
        { ...group('g2', heights[1]), tabs: ['outline'], activeTab: 'outline' },
      ],
      hiddenSidebarTabs: [],
    })

  test('a sized top group keeps its height and the unsized last group fills', () => {
    seed([300, null])
    render(<SidebarStack onRightClick={jest.fn()} />)
    const [top, last] = screen.getAllByTestId('sidebar-group')
    expect(top.style.height).toBe('300px')
    expectFills(last)
  })

  test('when both groups carry a stored height (any past handle drag), the last still fills', () => {
    seed([300, 200])
    render(<SidebarStack onRightClick={jest.fn()} />)
    const [top, last] = screen.getAllByTestId('sidebar-group')
    expect(top.style.height).toBe('300px')
    expect(top).not.toHaveClass('flex-1')
    expectFills(last)
  })
})

describe('RightSidebarStack: the last expanded group fills the stack', () => {
  const seed = (heights: [number | null, number | null]) =>
    useSettingsStore.setState({
      rightSidebarGroups: [
        { ...group('r1', heights[0]), tabs: ['properties'], activeTab: 'properties' },
        { ...group('r2', heights[1]), tabs: ['backlinks'], activeTab: 'backlinks' },
      ],
    })

  test('a sized top group keeps its height and the unsized last group fills', () => {
    seed([300, null])
    render(<RightSidebarStack />)
    const [top, last] = screen.getAllByTestId('right-sidebar-group')
    expect(top.style.height).toBe('300px')
    expectFills(last)
  })

  test('when both groups carry a stored height (any past handle drag), the last still fills', () => {
    seed([300, 200])
    render(<RightSidebarStack />)
    const [top, last] = screen.getAllByTestId('right-sidebar-group')
    expect(top.style.height).toBe('300px')
    expect(top).not.toHaveClass('flex-1')
    expectFills(last)
  })
})
