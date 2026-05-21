/**
 * openNotePreviewDefault.test.ts
 *
 * Covers the side-effect introduced in workspaceStore.openNote that
 * sets the global isPreviewMode flag based on
 * settingsStore.notesOpenInPreviewMode whenever a NEW tab opens.
 *
 * The side-effect uses dynamic imports to avoid circular dependencies,
 * so we await a tick for promise resolution before asserting.
 */

import { useWorkspaceStore } from '../stores/workspaceStore'
import { useNoteStore } from '../stores/noteStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

beforeEach(() => {
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
  useNoteStore.setState({
    notes: [{
      id: 'n1',
      title: 'Demo',
      content: '# Demo',
      folderId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isDeleted: false,
      deletedAt: null,
      isPinned: false,
      templateId: null,
    }],
    selectedNoteId: null,
  })
  useUIStore.setState({ isPreviewMode: false })
})

const settle = () => new Promise(r => setTimeout(r, 20))

test('opening a new tab flips isPreviewMode ON when the setting is true (default)', async () => {
  useSettingsStore.setState({ notesOpenInPreviewMode: true })
  expect(useUIStore.getState().isPreviewMode).toBe(false)

  useWorkspaceStore.getState().openNote('n1', { preview: false })
  await settle()

  expect(useUIStore.getState().isPreviewMode).toBe(true)
})

test('opening a new tab flips isPreviewMode OFF when the setting is false', async () => {
  useSettingsStore.setState({ notesOpenInPreviewMode: false })
  useUIStore.setState({ isPreviewMode: true }) // start in preview

  useWorkspaceStore.getState().openNote('n1', { preview: false })
  await settle()

  expect(useUIStore.getState().isPreviewMode).toBe(false)
})

test('refocusing an already-open tab does NOT change isPreviewMode', async () => {
  useSettingsStore.setState({ notesOpenInPreviewMode: true })

  // Pre-seed an open tab. Avoid going through openNote so we don't
  // trip the side-effect yet.
  useWorkspaceStore.setState({
    panes: [{
      id: 'p1',
      tabs: [{ id: 't1', kind: 'note', noteId: 'n1', isPreview: false }],
      activeTabId: 't1',
    }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
  // User toggled edit mode within this tab.
  useUIStore.setState({ isPreviewMode: false })

  // Calling openNote on an already-open note → refocus path.
  useWorkspaceStore.getState().openNote('n1', { preview: false })
  await settle()

  // Their edit-mode choice is preserved.
  expect(useUIStore.getState().isPreviewMode).toBe(false)
})
