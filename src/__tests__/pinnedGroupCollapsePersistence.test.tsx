/**
 * pinnedGroupCollapsePersistence.test.tsx
 *
 * Tests SidebarGroup collapse state in the new leaf model. The group
 * id is now stable + random; collapse state lives on the group object
 * itself (group.collapsed) via toggleGroupCollapsed.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// SidebarGroup renders PanelBody (via sidebarPanelRegistry) which
// attempts to mount full sidebar panels. Mock the registry to keep the
// tests focused on collapse behaviour only.
jest.mock('../components/sidebar/sidebarPanelRegistry', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return {
    PANELS: [
      {
        id: 'files',
        title: 'Files',
        Icon: () => React.createElement('span', { 'aria-label': 'files-icon' }),
      },
    ],
    KNOWN_IDS: new Set(['files']),
    PanelBody: ({ id }: { id: string }) =>
      React.createElement('div', { 'data-testid': `panel-body-${id}` }, `body:${id}`),
    TAB_DRAG_MIME: 'application/x-noteser-sidebar-tab',
  }
})

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SidebarGroup } from '../components/sidebar/SidebarGroup'
import { useSettingsStore } from '../stores/settingsStore'
import type { SidebarGroupState } from '../stores/settingsStore'

const GROUP_ID = 'test-group-1'
function makeGroup(collapsed = false): SidebarGroupState {
  return { id: GROUP_ID, tabs: ['files'], activeTab: 'files', collapsed }
}

function renderGroup(collapsed = false) {
  // Seed the store so toggleGroupCollapsed has the matching group to
  // flip (the component reads collapse from the prop, but the toggle
  // dispatches against the persisted shape).
  useSettingsStore.setState({ sidebarGroups: [makeGroup(collapsed)] })
  const onTabContextMenu = jest.fn()
  const onRightClick = jest.fn()
  return render(
    <SidebarGroup
      group={makeGroup(collapsed)}
      onTabContextMenu={onTabContextMenu}
      onRightClick={onRightClick}
    />
  )
}

beforeEach(() => {
  useSettingsStore.setState({ sidebarGroups: [makeGroup(false)] })
})

describe('SidebarGroup — collapse round-trip', () => {
  test('starts expanded (data-collapsed="false") when group.collapsed is false', () => {
    renderGroup(false)
    expect(screen.getByTestId('sidebar-group')).toHaveAttribute('data-collapsed', 'false')
  })

  test('panel body is visible when expanded', () => {
    renderGroup(false)
    expect(screen.getByTestId('panel-body-files')).toBeInTheDocument()
  })

  test('clicking toggle flips group.collapsed in the store', async () => {
    const user = userEvent.setup()
    renderGroup(false)
    const toggle = screen.getByTestId('sidebar-group-collapse-toggle')
    await user.click(toggle)
    const stored = useSettingsStore.getState().sidebarGroups.find(g => g.id === GROUP_ID)
    expect(stored?.collapsed).toBe(true)
  })

  test('rendering with collapsed=true hides the panel body', () => {
    renderGroup(true)
    expect(screen.getByTestId('sidebar-group')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.queryByTestId('panel-body-files')).not.toBeInTheDocument()
  })

  test('clicking toggle a second time flips back', async () => {
    const user = userEvent.setup()
    // Start collapsed in the store; render component with collapsed=true prop.
    useSettingsStore.setState({ sidebarGroups: [makeGroup(true)] })
    render(
      <SidebarGroup
        group={makeGroup(true)}
        onTabContextMenu={jest.fn()}
        onRightClick={jest.fn()}
      />
    )
    await user.click(screen.getByTestId('sidebar-group-collapse-toggle'))
    const stored = useSettingsStore.getState().sidebarGroups.find(g => g.id === GROUP_ID)
    expect(stored?.collapsed).toBe(false)
  })
})
