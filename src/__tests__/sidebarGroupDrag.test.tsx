/**
 * sidebarGroupDrag.test.tsx
 *
 * Covers the new Obsidian leaf-model sidebar refactor (2026-06-04):
 *
 *   - Click activity-bar icon for a panel NOT in any group → adds to
 *     last-focused (or last) group.
 *   - Click activity-bar icon for a panel that IS in a group → focuses
 *     the existing group.
 *   - Drag a panel onto an inter-group drop zone → creates a new group
 *     at that position.
 *   - Drag a tab between groups via the mini-strip → moves between
 *     groups.
 *   - Close tab via the store action → removes from group; group is
 *     dropped when the closed tab was its last member.
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
import { SidebarStack } from '../components/sidebar/SidebarStack'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { activatePanelFromActivityBar } from '../components/sidebar/sidebarGroupActions'

const TAB_DRAG_MIME = 'application/x-noteser-sidebar-tab'

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

function seedOneGroup(id = 'g1', tabs: string[] = ['calendar']) {
  useSettingsStore.setState({
    sidebarGroups: [{ id, tabs, activeTab: tabs[0] ?? null, collapsed: false }],
    hiddenSidebarTabs: [],
    ribbonOrder: [],
  })
  useUIStore.setState({ sidebarCollapsed: false, lastFocusedGroupId: id })
}

describe('Activity bar click — leaf model', () => {
  beforeEach(() => seedOneGroup())

  test('clicking an icon for a panel NOT in any group adds it to last-focused group', () => {
    render(<Ribbon />)
    // `outline` isn't in any group yet — click should add it.
    const button = screen.getByTestId('activity-bar-panel-outline').querySelector('button')!
    fireEvent.click(button)
    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toContain('outline')
    expect(groups[0].activeTab).toBe('outline')
  })

  test('a panel ALREADY in a group does NOT render an icon in the activity bar', () => {
    // Per the 2026-06-04 rule: icons for in-group panels are hidden
    // from the bar (the group's own mini-strip is its switcher).
    useSettingsStore.setState({
      sidebarGroups: [{ id: 'g1', tabs: ['calendar', 'outline'], activeTab: 'calendar', collapsed: false }],
      hiddenSidebarTabs: [],
    })
    useUIStore.setState({ sidebarCollapsed: false, lastFocusedGroupId: 'g1' })
    render(<Ribbon />)
    expect(screen.queryByTestId('activity-bar-panel-outline')).toBeNull()
    expect(screen.queryByTestId('activity-bar-panel-calendar')).toBeNull()
    // But a NOT-in-group panel still gets an icon.
    expect(screen.getByTestId('activity-bar-panel-files')).toBeTruthy()
  })

  test('calling activatePanelFromActivityBar for an in-group panel focuses it (via drag/mobile entry points)', () => {
    useSettingsStore.setState({
      sidebarGroups: [{ id: 'g1', tabs: ['calendar', 'outline'], activeTab: 'calendar', collapsed: false }],
      hiddenSidebarTabs: [],
    })
    useUIStore.setState({ sidebarCollapsed: false, lastFocusedGroupId: 'g1' })
    activatePanelFromActivityBar('outline')
    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual(['calendar', 'outline'])
    expect(groups[0].activeTab).toBe('outline')
  })

  test('activatePanelFromActivityBar unhides a hidden panel then adds to last-focused group', () => {
    useSettingsStore.setState({
      sidebarGroups: [{ id: 'g1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false }],
      hiddenSidebarTabs: ['outline'],
    })
    useUIStore.setState({ lastFocusedGroupId: 'g1', sidebarCollapsed: false })
    activatePanelFromActivityBar('outline')
    expect(useSettingsStore.getState().hiddenSidebarTabs).not.toContain('outline')
    expect(useSettingsStore.getState().sidebarGroups[0].tabs).toContain('outline')
  })
})

describe('Inter-group drop zone', () => {
  beforeEach(() => seedOneGroup('g1', ['calendar']))

  test('dropping a tab onto the trailing zone creates a new group', () => {
    render(<SidebarStack onRightClick={jest.fn()} />)
    const zones = screen.getAllByTestId('sidebar-inter-group-dropzone')
    expect(zones.length).toBeGreaterThanOrEqual(2)
    const trailing = zones[zones.length - 1]
    fireDragEventWithPayload(trailing, 'dragOver', { mime: TAB_DRAG_MIME, id: 'outline' })
    fireDragEventWithPayload(trailing, 'drop', { mime: TAB_DRAG_MIME, id: 'outline' })
    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups).toHaveLength(2)
    expect(groups[1].tabs).toEqual(['outline'])
  })
})

describe('Cross-group move via mini-strip drop', () => {
  test('dropping a tab onto another group strip moves it', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
        { id: 'g2', tabs: ['outline'], activeTab: 'outline', collapsed: false },
      ],
      hiddenSidebarTabs: [],
    })
    useUIStore.setState({ sidebarCollapsed: false, lastFocusedGroupId: 'g1' })
    render(<SidebarStack onRightClick={jest.fn()} />)
    const strips = screen.getAllByTestId('sidebar-pinned-strip')
    // strips[1] = g2's strip
    fireDragEventWithPayload(strips[1], 'dragOver', { mime: TAB_DRAG_MIME, id: 'calendar' })
    fireDragEventWithPayload(strips[1], 'drop', { mime: TAB_DRAG_MIME, id: 'calendar' })
    const groups = useSettingsStore.getState().sidebarGroups
    // calendar moved from g1 → g2; g1 emptied so it was dropped.
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('g2')
    expect(groups[0].tabs).toEqual(expect.arrayContaining(['outline', 'calendar']))
    expect(groups[0].activeTab).toBe('calendar')
  })
})

describe('Close tab via store action', () => {
  test('removing the last tab in a group drops the group', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
        { id: 'g2', tabs: ['outline'], activeTab: 'outline', collapsed: false },
      ],
    })
    useSettingsStore.getState().removeTabFromGroup('g1', 'calendar')
    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('g2')
  })

  test('removing a non-last tab keeps the group + falls back active', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['calendar', 'outline'], activeTab: 'calendar', collapsed: false },
      ],
    })
    useSettingsStore.getState().removeTabFromGroup('g1', 'calendar')
    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual(['outline'])
    expect(groups[0].activeTab).toBe('outline')
  })
})
