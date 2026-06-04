/**
 * crossSidebarMove.test.tsx
 *
 * Locks the 2026-06-04 cross-sidebar drag refactor (Feature A on the
 * fetch-timeouts branch). Coverage:
 *
 *   1. Drag a tab from the left activity bar onto a right group's
 *      mini-strip → appears in rightSidebarGroups + disappears from
 *      sidebarGroups.
 *   2. Drag from the right side onto a left group's strip → opposite
 *      direction works the same way (no MIME mismatch).
 *   3. moveTabAcrossSidebars used by the right-click "Move to other
 *      sidebar" path creates a singleton group on the OTHER side.
 *   4. Activity-bar dedup: a panel parked in ANY group (either side)
 *      hides its icon from BOTH the left and right ribbons.
 *
 * idb-keyval is mocked so Zustand persist doesn't hit IndexedDB
 * (unavailable in jsdom).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'

import { Ribbon } from '../components/sidebar/Ribbon'
import { RightRibbon } from '../components/sidebar/RightRibbon'
import { SidebarStack } from '../components/sidebar/SidebarStack'
import { RightSidebarStack } from '../components/sidebar/RightSidebarStack'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { moveTabAcrossSidebars } from '../components/sidebar/sidebarGroupActions'
import {
  TAB_DRAG_MIME,
} from '../components/sidebar/sidebarPanelRegistry'
import {
  RIGHT_TAB_DRAG_MIME,
} from '../components/sidebar/rightPanelRegistry'

class FakeDataTransfer {
  effectAllowed: string = ''
  dropEffect: string = ''
  types: string[] = []
  private data: Map<string, string> = new Map()
  getData(key: string): string { return this.data.get(key) ?? '' }
  setData(key: string, value: string): void {
    this.data.set(key, value)
    if (!this.types.includes(key)) this.types.push(key)
  }
  items = { add: jest.fn(), clear: jest.fn(), remove: jest.fn(), length: 0 }
}

;(globalThis as unknown as Record<string, unknown>).DataTransfer = FakeDataTransfer

function fireDragEventWithPayload(
  el: HTMLElement,
  eventName: 'dragOver' | 'drop',
  payload: { mime: string; id: string },
): void {
  const patchListener = (e: Event) => {
    const dragEv = e as DragEvent
    const fdt = new FakeDataTransfer()
    fdt.setData(payload.mime, payload.id)
    Object.defineProperty(dragEv, 'dataTransfer', { value: fdt, configurable: true })
  }
  el.addEventListener(eventName.toLowerCase(), patchListener, { capture: true })
  if (eventName === 'dragOver') fireEvent.dragOver(el)
  else fireEvent.drop(el)
  el.removeEventListener(eventName.toLowerCase(), patchListener, { capture: true })
}

function seedBothSides(): void {
  useSettingsStore.setState({
    sidebarGroups: [
      { id: 'gL1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
    ],
    rightSidebarGroups: [
      { id: 'gR1', tabs: ['properties'], activeTab: 'properties', collapsed: false },
    ],
    hiddenSidebarTabs: [],
    ribbonOrder: [],
  })
  useUIStore.setState({
    sidebarCollapsed: false,
    rightSidebarCollapsed: false,
    lastFocusedGroupId: 'gL1',
    lastFocusedRightGroupId: 'gR1',
  })
}

describe('Drag MIME is unified across both sides', () => {
  test('RIGHT_TAB_DRAG_MIME equals TAB_DRAG_MIME (single payload shape)', () => {
    expect(RIGHT_TAB_DRAG_MIME).toBe(TAB_DRAG_MIME)
  })
})

describe('Drag left → right (panel icon onto right group strip)', () => {
  beforeEach(() => seedBothSides())

  test('drop on the right group strip moves the tab across', () => {
    render(<RightSidebarStack />)
    const strips = screen.getAllByTestId('right-sidebar-pinned-strip')
    expect(strips).toHaveLength(1)
    fireDragEventWithPayload(strips[0], 'dragOver', { mime: TAB_DRAG_MIME, id: 'calendar' })
    fireDragEventWithPayload(strips[0], 'drop', { mime: TAB_DRAG_MIME, id: 'calendar' })

    const state = useSettingsStore.getState()
    // Calendar should now live on the right side.
    expect(state.rightSidebarGroups[0].tabs).toEqual(
      expect.arrayContaining(['properties', 'calendar']),
    )
    // The left group held only `calendar` — it should be dropped now
    // that it's empty.
    expect(state.sidebarGroups).toHaveLength(0)
  })

  test('drop on the right trailing inter-group zone spawns a new right group', () => {
    render(<RightSidebarStack />)
    const zones = screen.getAllByTestId('right-sidebar-inter-group-dropzone')
    const trailing = zones[zones.length - 1]
    fireDragEventWithPayload(trailing, 'dragOver', { mime: TAB_DRAG_MIME, id: 'calendar' })
    fireDragEventWithPayload(trailing, 'drop', { mime: TAB_DRAG_MIME, id: 'calendar' })

    const state = useSettingsStore.getState()
    // 2 right groups: original + new one with calendar.
    expect(state.rightSidebarGroups).toHaveLength(2)
    expect(state.rightSidebarGroups.some(g => g.tabs.includes('calendar'))).toBe(true)
    // Left side lost it.
    expect(state.sidebarGroups).toHaveLength(0)
  })
})

describe('Drag right → left', () => {
  beforeEach(() => seedBothSides())

  test('drop on a left group strip moves the right-side tab across', () => {
    render(<SidebarStack onRightClick={jest.fn()} />)
    const strips = screen.getAllByTestId('sidebar-pinned-strip')
    expect(strips).toHaveLength(1)
    fireDragEventWithPayload(strips[0], 'dragOver', { mime: TAB_DRAG_MIME, id: 'properties' })
    fireDragEventWithPayload(strips[0], 'drop', { mime: TAB_DRAG_MIME, id: 'properties' })

    const state = useSettingsStore.getState()
    expect(state.sidebarGroups[0].tabs).toEqual(
      expect.arrayContaining(['calendar', 'properties']),
    )
    expect(state.rightSidebarGroups).toHaveLength(0)
  })
})

describe('moveTabAcrossSidebars (right-click "Move to other sidebar")', () => {
  beforeEach(() => seedBothSides())

  test('left → right: removes from left, creates singleton on right', () => {
    moveTabAcrossSidebars('calendar', 'right', null)
    const state = useSettingsStore.getState()
    expect(state.sidebarGroups).toHaveLength(0)
    // Two right groups: original properties + a fresh singleton with calendar.
    expect(state.rightSidebarGroups).toHaveLength(2)
    expect(state.rightSidebarGroups.some(g => g.tabs.includes('calendar'))).toBe(true)
  })

  test('right → left: removes from right, creates singleton on left', () => {
    moveTabAcrossSidebars('properties', 'left', null)
    const state = useSettingsStore.getState()
    expect(state.rightSidebarGroups).toHaveLength(0)
    expect(state.sidebarGroups).toHaveLength(2)
    expect(state.sidebarGroups.some(g => g.tabs.includes('properties'))).toBe(true)
  })

  test('is a no-op when the tab is not on the other side', () => {
    // calendar is already on the left; asking to move-to-left is a
    // no-op.
    const before = useSettingsStore.getState()
    moveTabAcrossSidebars('calendar', 'left', null)
    const after = useSettingsStore.getState()
    expect(after.sidebarGroups).toEqual(before.sidebarGroups)
    expect(after.rightSidebarGroups).toEqual(before.rightSidebarGroups)
  })
})

describe('Activity-bar dedup across both sides', () => {
  test('a panel in a LEFT group does not render an icon on EITHER bar', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'gL1', tabs: ['plugins'], activeTab: 'plugins', collapsed: false },
      ],
      rightSidebarGroups: [],
      hiddenSidebarTabs: [],
      ribbonOrder: [],
    })
    useUIStore.setState({ sidebarCollapsed: false, rightSidebarCollapsed: false })
    const { unmount } = render(<Ribbon />)
    expect(screen.queryByTestId('activity-bar-panel-plugins')).toBeNull()
    unmount()
    render(<RightRibbon />)
    // The right ribbon never showed Plugins (it's not a right default)
    // — but neither does it show Properties unless Properties is
    // missing from every group. Confirm Plugins is absent regardless.
    expect(screen.queryByTestId('right-activity-bar-panel-plugins')).toBeNull()
  })

  test('a right-default panel dragged to the LEFT side hides from the RIGHT bar', () => {
    // Properties starts on the right; user drags it to the left side.
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'gL1', tabs: ['calendar', 'properties'], activeTab: 'properties', collapsed: false },
      ],
      rightSidebarGroups: [],
      hiddenSidebarTabs: [],
      ribbonOrder: [],
    })
    useUIStore.setState({ sidebarCollapsed: false, rightSidebarCollapsed: false })
    render(<RightRibbon />)
    expect(screen.queryByTestId('right-activity-bar-panel-properties')).toBeNull()
  })

  test('a left-default panel dragged to the RIGHT side hides from the LEFT bar', () => {
    // Plugins lives on the right side (after a cross-sidebar drag).
    // The left ribbon should no longer show Plugins.
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'gL1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
      ],
      rightSidebarGroups: [
        { id: 'gR1', tabs: ['properties', 'plugins'], activeTab: 'plugins', collapsed: false },
      ],
      hiddenSidebarTabs: [],
      ribbonOrder: [],
    })
    useUIStore.setState({ sidebarCollapsed: false, rightSidebarCollapsed: false })
    render(<Ribbon />)
    expect(screen.queryByTestId('activity-bar-panel-plugins')).toBeNull()
    // calendar is still in the left group, so its icon is also hidden.
    expect(screen.queryByTestId('activity-bar-panel-calendar')).toBeNull()
    // But other panels (e.g. files) that aren't in any group ARE shown.
    expect(screen.getByTestId('activity-bar-panel-files')).toBeTruthy()
  })
})
