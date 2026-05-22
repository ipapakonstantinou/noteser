/**
 * pinnedGroupCollapsePersistence.test.tsx
 *
 * Tests for PinnedGroup collapse state:
 *   - Clicking the toggle sets data-collapsed="true" and hides the body.
 *   - The groupKey is stored in useSettingsStore.collapsedPinnedGroups.
 *   - Remounting with the same group reads the persisted key → starts collapsed.
 *   - Clicking again expands and removes the key from the store.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// PinnedGroup renders PanelBody (via sidebarPanelRegistry) which attempts
// to mount full sidebar panels. Mock sidebarPanelRegistry to keep the
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
    PanelBody: ({ id }: { id: string }) =>
      React.createElement('div', { 'data-testid': `panel-body-${id}` }, `body:${id}`),
    TAB_DRAG_MIME: 'application/x-noteser-sidebar-tab',
    resolveTabOrder: (saved: string[], pinned: string[]) =>
      saved.filter((id: string) => !pinned.includes(id)),
  }
})

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PinnedGroup } from '../components/sidebar/PinnedGroup'
import { useSettingsStore } from '../stores/settingsStore'
import type { SidebarTabId } from '../stores/uiStore'

// ── helpers ───────────────────────────────────────────────────────────────────

const GROUP: SidebarTabId[] = ['files']
const GROUP_KEY = GROUP.join(',') // "files"

function renderPinnedGroup() {
  const onUnpin = jest.fn()
  const onAddToThisGroup = jest.fn()
  const onReorder = jest.fn()
  const onRightClick = jest.fn()
  const onTabContextMenu = jest.fn()
  const utils = render(
    <PinnedGroup
      group={GROUP}
      onUnpin={onUnpin}
      onAddToThisGroup={onAddToThisGroup}
      onReorder={onReorder}
      onRightClick={onRightClick}
      onTabContextMenu={onTabContextMenu}
    />
  )
  return utils
}

beforeEach(() => {
  useSettingsStore.setState({ collapsedPinnedGroups: [] })
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('PinnedGroup — collapse persistence round-trip', () => {
  test('starts expanded (data-collapsed="false")', () => {
    renderPinnedGroup()
    const group = screen.getByTestId('pinned-group')
    expect(group).toHaveAttribute('data-collapsed', 'false')
  })

  test('panel body is visible when expanded', () => {
    renderPinnedGroup()
    expect(screen.getByTestId('panel-body-files')).toBeInTheDocument()
  })

  test('clicking toggle sets data-collapsed="true" and removes body from DOM', async () => {
    const user = userEvent.setup()
    renderPinnedGroup()
    const toggle = screen.getByTestId('pinned-group-collapse-toggle')
    await user.click(toggle)
    const group = screen.getByTestId('pinned-group')
    expect(group).toHaveAttribute('data-collapsed', 'true')
    expect(screen.queryByTestId('panel-body-files')).not.toBeInTheDocument()
  })

  test('clicking toggle persists groupKey to useSettingsStore.collapsedPinnedGroups', async () => {
    const user = userEvent.setup()
    renderPinnedGroup()
    await user.click(screen.getByTestId('pinned-group-collapse-toggle'))
    expect(useSettingsStore.getState().collapsedPinnedGroups).toContain(GROUP_KEY)
  })

  test('remounting with same group composition starts collapsed when key is in store', () => {
    // Pre-seed the store as if the user had previously collapsed this group.
    useSettingsStore.setState({ collapsedPinnedGroups: [GROUP_KEY] })
    renderPinnedGroup()
    const group = screen.getByTestId('pinned-group')
    expect(group).toHaveAttribute('data-collapsed', 'true')
    // Body must be absent.
    expect(screen.queryByTestId('panel-body-files')).not.toBeInTheDocument()
  })

  test('clicking toggle a second time expands and removes key from store', async () => {
    const user = userEvent.setup()
    renderPinnedGroup()
    const toggle = screen.getByTestId('pinned-group-collapse-toggle')
    // collapse
    await user.click(toggle)
    // expand
    await user.click(toggle)
    const group = screen.getByTestId('pinned-group')
    expect(group).toHaveAttribute('data-collapsed', 'false')
    expect(useSettingsStore.getState().collapsedPinnedGroups).not.toContain(GROUP_KEY)
  })
})
