/**
 * openNotePreviewDefault.test.ts
 *
 * Covers the side-effect in workspaceStore.openNote that decides the
 * view mode (rendered preview vs editable source) a freshly-opened note
 * lands in:
 *
 *  - With NO note already open (cold start), it seeds the global
 *    isPreviewMode flag from settingsStore.notesOpenInPreviewMode.
 *  - With a note ALREADY open, the new note inherits the current
 *    (last-used) global mode and the setting is NOT re-applied — so
 *    opening a note keeps you in the same mode the last note was in.
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
    notes: [
      {
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
      },
      {
        id: 'n2',
        title: 'Second',
        content: '# Second',
        folderId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      },
    ],
    selectedNoteId: null,
  })
  useUIStore.setState({ isPreviewMode: false })
})

const settle = () => new Promise(r => setTimeout(r, 20))

test('cold start (no note open) flips isPreviewMode ON when the setting is true (default)', async () => {
  useSettingsStore.setState({ notesOpenInPreviewMode: true })
  expect(useUIStore.getState().isPreviewMode).toBe(false)

  useWorkspaceStore.getState().openNote('n1', { preview: false })
  await settle()

  expect(useUIStore.getState().isPreviewMode).toBe(true)
})

test('cold start (no note open) flips isPreviewMode OFF when the setting is false', async () => {
  useSettingsStore.setState({ notesOpenInPreviewMode: false })
  useUIStore.setState({ isPreviewMode: true }) // start in preview

  useWorkspaceStore.getState().openNote('n1', { preview: false })
  await settle()

  expect(useUIStore.getState().isPreviewMode).toBe(false)
})

test('opening a note while another is open keeps the last-used mode, ignoring the default setting', async () => {
  // Default says "open in preview", but the user is currently in EDIT
  // mode on an already-open note. Opening a different note must keep
  // them in edit mode (last-used wins), NOT snap back to preview.
  useSettingsStore.setState({ notesOpenInPreviewMode: true })
  useWorkspaceStore.setState({
    panes: [{
      id: 'p1',
      tabs: [{ id: 't1', kind: 'note', noteId: 'n1', isPreview: false }],
      activeTabId: 't1',
    }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
  useUIStore.setState({ isPreviewMode: false }) // last-used = edit

  useWorkspaceStore.getState().openNote('n2', { preview: false })
  await settle()

  expect(useUIStore.getState().isPreviewMode).toBe(false)
})

test('opening a note while another is open keeps preview when last-used was preview', async () => {
  // Mirror of the above: default says edit, last-used was preview;
  // opening a fresh note keeps preview.
  useSettingsStore.setState({ notesOpenInPreviewMode: false })
  useWorkspaceStore.setState({
    panes: [{
      id: 'p1',
      tabs: [{ id: 't1', kind: 'note', noteId: 'n1', isPreview: false }],
      activeTabId: 't1',
    }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
  useUIStore.setState({ isPreviewMode: true }) // last-used = preview

  useWorkspaceStore.getState().openNote('n2', { preview: false })
  await settle()

  expect(useUIStore.getState().isPreviewMode).toBe(true)
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
