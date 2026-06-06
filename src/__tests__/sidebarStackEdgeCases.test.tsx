/**
 * sidebarStackEdgeCases.test.tsx
 *
 * Edge cases for SidebarStack + sidebarGroupActions not covered elsewhere:
 *
 *   1. SidebarStack renders an empty-state prompt when all panels are
 *      hidden (groups sanitises down to []).
 *   2. SidebarStack with collapsed groups: resize handle does NOT mount
 *      between a collapsed group and its neighbour (both would need to be
 *      expanded).
 *   3. findGroupWithTab — pure helper: returns null when the tab is
 *      in no group; returns the correct group when it is.
 *   4. activatePanelFromActivityBar — empty group stack creates a new
 *      group instead of crashing.
 *   5. moveTabToNewGroup inserts the new group AFTER the source group.
 *   6. closeTabInGroup when the group had 2 tabs keeps the group with
 *      one tab remaining and correct activeTab fallback.
 *
 * idb-keyval is mocked; sidebarPanelRegistry is mocked to keep the render
 * shallow (avoids pulling in every panel's dependencies).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// Stub the panel registry so SidebarStack/SidebarGroup don't try to render
// real panels (FolderTree, CalendarView, etc.) in jsdom.
jest.mock('../components/sidebar/sidebarPanelRegistry', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return {
    PANELS: [
      { id: 'files', title: 'Files', Icon: () => React.createElement('span') },
      { id: 'calendar', title: 'Calendar', Icon: () => React.createElement('span') },
      { id: 'outline', title: 'Outline', Icon: () => React.createElement('span') },
    ],
    KNOWN_IDS: new Set(['files', 'calendar', 'outline']),
    PanelBody: ({ id }: { id: string }) =>
      React.createElement('div', { 'data-testid': `panel-body-${id}` }),
    TAB_DRAG_MIME: 'application/x-noteser-sidebar-tab',
  }
})

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { SidebarStack } from '../components/sidebar/SidebarStack'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import {
  findGroupWithTab,
  activatePanelFromActivityBar,
  moveTabToNewGroup,
  closeTabInGroup,
} from '../components/sidebar/sidebarGroupActions'
import type { SidebarGroupState } from '../stores/settingsStore'

function seedGroups(groups: SidebarGroupState[]) {
  useSettingsStore.setState({
    sidebarGroups: groups,
    hiddenSidebarTabs: [],
    ribbonOrder: [],
  })
  useUIStore.setState({
    sidebarCollapsed: false,
    lastFocusedGroupId: groups[0]?.id ?? null,
  })
}

beforeEach(() => {
  useSettingsStore.setState({
    sidebarGroups: [],
    hiddenSidebarTabs: [],
    ribbonOrder: [],
  })
  useUIStore.setState({ sidebarCollapsed: false, lastFocusedGroupId: null })
})

// ── 1. Empty sidebar (all panels hidden) ─────────────────────────────────────

describe('SidebarStack — empty state', () => {
  test('shows the empty-state prompt when all panels are hidden and no groups exist', () => {
    seedGroups([])
    render(<SidebarStack onRightClick={jest.fn()} />)
    expect(screen.getByTestId('sidebar-empty')).toBeInTheDocument()
  })

  test('does NOT show the empty-state prompt when at least one group exists', () => {
    seedGroups([{ id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false }])
    render(<SidebarStack onRightClick={jest.fn()} />)
    expect(screen.queryByTestId('sidebar-empty')).not.toBeInTheDocument()
  })

  test('shows the empty-state prompt when all tabs are in hiddenSidebarTabs', () => {
    // Seeding a group with 'files', but 'files' is in hiddenSidebarTabs →
    // SidebarStack sanitises it away → renders as empty.
    useSettingsStore.setState({
      sidebarGroups: [{ id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false }],
      hiddenSidebarTabs: ['files'],
      ribbonOrder: [],
    })
    render(<SidebarStack onRightClick={jest.fn()} />)
    expect(screen.getByTestId('sidebar-empty')).toBeInTheDocument()
  })
})

// ── 2. Resize handle not shown between collapsed groups ───────────────────────

describe('SidebarStack — resize handle visibility', () => {
  test('no resize handle when only one group is present', () => {
    seedGroups([{ id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false }])
    render(<SidebarStack onRightClick={jest.fn()} />)
    expect(screen.queryByTestId('sidebar-group-resize-handle')).not.toBeInTheDocument()
  })

  test('resize handle appears between two EXPANDED groups', () => {
    seedGroups([
      { id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false },
      { id: 'g2', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
    ])
    render(<SidebarStack onRightClick={jest.fn()} />)
    expect(screen.getByTestId('sidebar-group-resize-handle')).toBeInTheDocument()
  })

  test('resize handle is absent when the ABOVE group is collapsed', () => {
    seedGroups([
      { id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: true },  // collapsed
      { id: 'g2', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
    ])
    render(<SidebarStack onRightClick={jest.fn()} />)
    expect(screen.queryByTestId('sidebar-group-resize-handle')).not.toBeInTheDocument()
  })

  test('resize handle is absent when the BELOW group is collapsed', () => {
    seedGroups([
      { id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false },
      { id: 'g2', tabs: ['calendar'], activeTab: 'calendar', collapsed: true }, // collapsed
    ])
    render(<SidebarStack onRightClick={jest.fn()} />)
    expect(screen.queryByTestId('sidebar-group-resize-handle')).not.toBeInTheDocument()
  })

  test('resize handles appear between every pair of expanded groups (3 groups → 2 handles)', () => {
    seedGroups([
      { id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false },
      { id: 'g2', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
      { id: 'g3', tabs: ['outline'], activeTab: 'outline', collapsed: false },
    ])
    render(<SidebarStack onRightClick={jest.fn()} />)
    expect(screen.getAllByTestId('sidebar-group-resize-handle')).toHaveLength(2)
  })
})

// ── 3. findGroupWithTab — pure helper ─────────────────────────────────────────

describe('findGroupWithTab', () => {
  const groups: SidebarGroupState[] = [
    { id: 'g1', tabs: ['files', 'calendar'], activeTab: 'files', collapsed: false },
    { id: 'g2', tabs: ['outline'], activeTab: 'outline', collapsed: false },
  ]

  test('returns the group that contains the tab', () => {
    expect(findGroupWithTab(groups, 'calendar')).toBe(groups[0])
    expect(findGroupWithTab(groups, 'outline')).toBe(groups[1])
  })

  test('returns null when the tab is not in any group', () => {
    // 'search' is a valid SidebarTabId but not present in any group above.
    expect(findGroupWithTab(groups, 'search')).toBeNull()
  })

  test('returns null for an empty groups array', () => {
    expect(findGroupWithTab([], 'files')).toBeNull()
  })
})

// ── 4. activatePanelFromActivityBar with empty stack ──────────────────────────

describe('activatePanelFromActivityBar — empty stack', () => {
  test('creates a new group when the stack is empty', () => {
    useSettingsStore.setState({ sidebarGroups: [], hiddenSidebarTabs: [] })
    useUIStore.setState({ sidebarCollapsed: false, lastFocusedGroupId: null })

    activatePanelFromActivityBar('files')

    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual(['files'])
    expect(groups[0].activeTab).toBe('files')
  })

  test('opens the sidebar if it was collapsed', () => {
    useUIStore.setState({ sidebarCollapsed: true })
    useSettingsStore.setState({ sidebarGroups: [] })

    activatePanelFromActivityBar('files')

    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })
})

// ── 5. moveTabToNewGroup inserts AFTER the source group ───────────────────────

describe('moveTabToNewGroup', () => {
  test('places the new group immediately after the source group', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['files', 'calendar'], activeTab: 'files', collapsed: false },
        { id: 'g2', tabs: ['outline'], activeTab: 'outline', collapsed: false },
      ],
    })

    moveTabToNewGroup('files')

    const groups = useSettingsStore.getState().sidebarGroups
    // Expect: [g1(calendar), new-group(files), g2(outline)]
    expect(groups).toHaveLength(3)
    expect(groups[0].tabs).toEqual(['calendar'])
    expect(groups[1].tabs).toEqual(['files'])
    expect(groups[2].tabs).toEqual(['outline'])
  })

  test('new group is appended at the end when the tab was in the last group', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false },
        { id: 'g2', tabs: ['calendar', 'outline'], activeTab: 'calendar', collapsed: false },
      ],
    })

    moveTabToNewGroup('outline')

    const groups = useSettingsStore.getState().sidebarGroups
    // g2 loses 'outline' but keeps 'calendar'; a new group with 'outline' is appended.
    expect(groups).toHaveLength(3)
    expect(groups[2].tabs).toEqual(['outline'])
  })
})

// ── 6. closeTabInGroup with 2 tabs keeps the group ────────────────────────────

describe('closeTabInGroup', () => {
  test('closing one of two tabs keeps the group with the remaining tab as activeTab', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['files', 'calendar'], activeTab: 'files', collapsed: false },
      ],
    })

    closeTabInGroup('g1', 'files')

    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual(['calendar'])
    expect(groups[0].activeTab).toBe('calendar')
  })

  test('closing the last tab in a group drops the group', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['files'], activeTab: 'files', collapsed: false },
        { id: 'g2', tabs: ['calendar'], activeTab: 'calendar', collapsed: false },
      ],
    })

    closeTabInGroup('g1', 'files')

    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('g2')
  })

  test('closing a non-active tab keeps the active tab unchanged', () => {
    useSettingsStore.setState({
      sidebarGroups: [
        { id: 'g1', tabs: ['files', 'calendar', 'outline'], activeTab: 'calendar', collapsed: false },
      ],
    })

    closeTabInGroup('g1', 'outline')

    const groups = useSettingsStore.getState().sidebarGroups
    expect(groups[0].tabs).toEqual(['files', 'calendar'])
    expect(groups[0].activeTab).toBe('calendar')
  })
})
