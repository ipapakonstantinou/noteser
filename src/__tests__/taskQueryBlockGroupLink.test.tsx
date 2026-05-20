/**
 * taskQueryBlockGroupLink.test.tsx
 *
 * Verifies the group-header link in TaskQueryBlock — when the user
 * groups by filename, the filename segment renders as a clickable
 * link to the source note (task 112).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskQueryBlock } from '../components/editor/TaskQueryBlock'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

beforeEach(() => {
  useNoteStore.setState({
    notes: [
      {
        id: 'n1',
        title: '2026-05-20',
        content: '## To Do\n- [ ] write tests\n- [ ] ship feature',
        folderId: 'f1',
        createdAt: 0, updatedAt: 1,
        isDeleted: false, deletedAt: null,
        isPinned: false, templateId: null,
        gitPath: null, gitLastPushedSha: null,
      },
    ],
    selectedNoteId: null,
  })
  useFolderStore.setState({
    folders: [
      { id: 'f1', name: 'Daily', parentId: null,
        createdAt: 0, updatedAt: 0, isDeleted: false, deletedAt: null,
        order: 0 },
    ],
    activeFolderId: null,
    expandedFolders: {},
    deletedFolderPaths: [],
  })
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
})

test('group header renders the filename as a link when groupBy includes filename', () => {
  render(<TaskQueryBlock source={'not done\ngroup by filename'} />)
  const link = screen.getByTestId('task-query-header-link-n1')
  expect(link).toBeInTheDocument()
  expect(link).toHaveTextContent('2026-05-20')
})

test('clicking the filename link opens the source note in the workspace', () => {
  const openSpy = jest.fn()
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
    openNote: openSpy,
  } as unknown as Parameters<typeof useWorkspaceStore.setState>[0])

  render(<TaskQueryBlock source={'not done\ngroup by filename'} />)
  fireEvent.click(screen.getByTestId('task-query-header-link-n1'))
  expect(openSpy).toHaveBeenCalledWith('n1', { preview: false })
})

test('no group-header link when groupBy is folder-only (no filename)', () => {
  render(<TaskQueryBlock source={'not done\ngroup by folder'} />)
  // Daily is the group header text but it's plain prose.
  expect(screen.queryByTestId(/task-query-header-link-/)).not.toBeInTheDocument()
})

test('multi-axis groupBy makes only the filename segment a link', () => {
  // Parser takes one "group by X" clause per line; multiple axes are
  // expressed as multiple lines.
  render(<TaskQueryBlock source={'not done\ngroup by folder\ngroup by filename'} />)
  // Filename segment gets the link.
  expect(screen.getByTestId('task-query-header-link-n1')).toBeInTheDocument()
  // The folder segment ("Daily") is plain prose — no link in the
  // header for it.
  const folderLink = screen.queryAllByRole('link').find(
    (el) => el.textContent === 'Daily',
  )
  expect(folderLink).toBeUndefined()
})

test('no group-header link when query has no groupBy', () => {
  render(<TaskQueryBlock source={'not done'} />)
  expect(screen.queryByTestId(/task-query-header-link-/)).not.toBeInTheDocument()
})
