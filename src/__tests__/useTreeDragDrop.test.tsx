/**
 * useTreeDragDrop.test.tsx
 *
 * Exercises the hook's begin/over/drop/end transitions for notes and
 * attachments. We mount via @testing-library/react and inspect dragOverTarget
 * + the side effects on noteStore (note moves) and the attachments helpers
 * (mocked).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// Mock the composed move helper the hook now delegates to. Older tests
// mocked the lower-level moveAttachment; both names are kept on the
// module surface, but the hook only touches the composed one.
const moveAttachmentMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../utils/attachments', () => ({
  moveAttachmentAndRewriteRefs: (...args: unknown[]) => moveAttachmentMock(...args),
}))

import React, { useImperativeHandle, forwardRef } from 'react'
import { render, act } from '@testing-library/react'
import { useTreeDragDrop, type TreeDragDropApi } from '../hooks/useTreeDragDrop'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'

// Tiny harness that exposes the hook API via a ref so tests can call
// individual handlers directly (mirrors how FolderTree wires them onto
// real elements without forcing us to simulate full HTML5 drag events).
const Harness = forwardRef<TreeDragDropApi, { getFolderRepoPath: (id: string) => string | undefined }>(
  function Harness(props, ref) {
    const api = useTreeDragDrop({ getFolderRepoPath: props.getFolderRepoPath })
    useImperativeHandle(ref, () => api, [api])
    return <div data-target={api.dragOverTarget ?? ''} />
  },
)

function mountHarness(getFolderRepoPath: (id: string) => string | undefined = () => undefined) {
  const ref = React.createRef<TreeDragDropApi>()
  const utils = render(<Harness ref={ref} getFolderRepoPath={getFolderRepoPath} />)
  return { api: () => ref.current!, ...utils }
}

// Fake React.DragEvent. setData/setDropEffect just record; preventDefault
// and stopPropagation are no-ops (the hook calls both — the latter was
// added to fix the "drop to root doesn't work" bubbling bug).
function makeDragEvent(): React.DragEvent {
  const calls: Array<[string, string]> = []
  return {
    dataTransfer: {
      setData: (k: string, v: string) => { calls.push([k, v]) },
      effectAllowed: '' as DataTransfer['effectAllowed'],
      dropEffect: '' as DataTransfer['dropEffect'],
    } as unknown as DataTransfer,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    currentTarget: {} as EventTarget,
    target: {} as EventTarget,
  } as unknown as React.DragEvent
}

beforeEach(() => {
  moveAttachmentMock.mockClear()
  // Reset stores between tests.
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {}, deletedFolderPaths: [] })
})

function seedFolders(input: Array<{ id: string; parentId?: string | null; name?: string }>) {
  useFolderStore.setState({
    folders: input.map((f, i) => ({
      id: f.id,
      name: f.name ?? f.id,
      parentId: f.parentId ?? null,
      createdAt: 0,
      updatedAt: 0,
      isDeleted: false,
      deletedAt: null,
      order: i,
    })),
  })
}

describe('useTreeDragDrop', () => {
  test('dragOverTarget starts null', () => {
    const { api } = mountHarness()
    expect(api().dragOverTarget).toBeNull()
  })

  test('beginNoteDrag + onFolderDragOver sets the highlight; endDrag clears it', () => {
    const { api } = mountHarness()
    act(() => { api().beginNoteDrag(makeDragEvent(), 'note-1') })
    act(() => { api().onFolderDragOver(makeDragEvent(), 'folder-1') })
    expect(api().dragOverTarget).toBe('folder-1')
    act(() => { api().endDrag() })
    expect(api().dragOverTarget).toBeNull()
  })

  test('onFolderDragOver is a no-op when nothing is being dragged', () => {
    const { api } = mountHarness()
    act(() => { api().onFolderDragOver(makeDragEvent(), 'folder-1') })
    expect(api().dragOverTarget).toBeNull()
  })

  test('onFolderDragLeave clears the matching target only', () => {
    const { api } = mountHarness()
    act(() => { api().beginNoteDrag(makeDragEvent(), 'n') })
    act(() => { api().onFolderDragOver(makeDragEvent(), 'folder-A') })
    expect(api().dragOverTarget).toBe('folder-A')
    act(() => { api().onFolderDragLeave('folder-B') })
    expect(api().dragOverTarget).toBe('folder-A') // unchanged
    act(() => { api().onFolderDragLeave('folder-A') })
    expect(api().dragOverTarget).toBeNull()
  })

  test('onFolderDrop with a note triggers moveNoteToFolder', () => {
    // Seed the note store with a note in root.
    useNoteStore.setState({
      notes: [
        { id: 'note-x', title: '', content: '', folderId: null,
          createdAt: 0, updatedAt: 0, isDeleted: false, deletedAt: null,
          isPinned: false, templateId: null },
      ],
      selectedNoteId: null,
    })
    const { api } = mountHarness()
    act(() => { api().beginNoteDrag(makeDragEvent(), 'note-x') })
    act(() => { api().onFolderDrop(makeDragEvent(), 'folder-X') })
    expect(useNoteStore.getState().notes[0].folderId).toBe('folder-X')
  })

  test('onFolderDrop with an attachment triggers moveAttachment + clears the dragged item', async () => {
    const { api } = mountHarness((id) => id === 'folder-images' ? 'images' : undefined)
    act(() => { api().beginAttachmentDrag(makeDragEvent(), 'attachments/old.png') })
    await act(async () => { api().onFolderDrop(makeDragEvent(), 'folder-images') })
    expect(moveAttachmentMock).toHaveBeenCalledWith('attachments/old.png', 'images/old.png')
    expect(api().dragOverTarget).toBeNull()
  })

  test('onRootDrop with an attachment moves it to a bare filename (no folder prefix)', async () => {
    const { api } = mountHarness()
    act(() => { api().beginAttachmentDrag(makeDragEvent(), 'attachments/pic.png') })
    await act(async () => { api().onRootDrop(makeDragEvent()) })
    expect(moveAttachmentMock).toHaveBeenCalledWith('attachments/pic.png', 'pic.png')
  })

  test('moving an attachment to its own folder is a no-op', async () => {
    const { api } = mountHarness((id) => id === 'self' ? 'attachments' : undefined)
    act(() => { api().beginAttachmentDrag(makeDragEvent(), 'attachments/pic.png') })
    await act(async () => { api().onFolderDrop(makeDragEvent(), 'self') })
    expect(moveAttachmentMock).not.toHaveBeenCalled()
  })

  // ── Folder drag-and-drop ────────────────────────────────────────────────

  test('dragging folder A onto folder B sets A.parentId = B', () => {
    seedFolders([{ id: 'A' }, { id: 'B' }])
    const { api } = mountHarness()
    act(() => { api().beginFolderDrag(makeDragEvent(), 'A') })
    act(() => { api().onFolderDrop(makeDragEvent(), 'B') })
    const a = useFolderStore.getState().folders.find(f => f.id === 'A')
    expect(a?.parentId).toBe('B')
  })

  test('dragging folder A onto root clears its parentId', () => {
    seedFolders([{ id: 'parent' }, { id: 'A', parentId: 'parent' }])
    const { api } = mountHarness()
    act(() => { api().beginFolderDrag(makeDragEvent(), 'A') })
    act(() => { api().onRootDrop(makeDragEvent()) })
    const a = useFolderStore.getState().folders.find(f => f.id === 'A')
    expect(a?.parentId).toBeNull()
  })

  test('dropping a folder onto itself is a no-op', () => {
    seedFolders([{ id: 'A', parentId: 'P' }, { id: 'P' }])
    const { api } = mountHarness()
    act(() => { api().beginFolderDrag(makeDragEvent(), 'A') })
    act(() => { api().onFolderDrop(makeDragEvent(), 'A') })
    const a = useFolderStore.getState().folders.find(f => f.id === 'A')
    // Unchanged — still nested under its original parent
    expect(a?.parentId).toBe('P')
  })

  test('dropping a folder into one of its own descendants is rejected (no cycle)', () => {
    //   A
    //   └── B
    //       └── C
    seedFolders([
      { id: 'A' },
      { id: 'B', parentId: 'A' },
      { id: 'C', parentId: 'B' },
    ])
    const { api } = mountHarness()
    act(() => { api().beginFolderDrag(makeDragEvent(), 'A') })
    // Attempt to drop A into C — would create A→B→C→A cycle.
    act(() => { api().onFolderDrop(makeDragEvent(), 'C') })
    const a = useFolderStore.getState().folders.find(f => f.id === 'A')
    expect(a?.parentId).toBeNull() // unchanged
  })

  test('dropping a folder into its current parent is a no-op', () => {
    seedFolders([{ id: 'P' }, { id: 'A', parentId: 'P' }])
    const { api } = mountHarness()
    act(() => { api().beginFolderDrag(makeDragEvent(), 'A') })
    act(() => { api().onFolderDrop(makeDragEvent(), 'P') })
    const a = useFolderStore.getState().folders.find(f => f.id === 'A')
    expect(a?.parentId).toBe('P') // unchanged
  })
})
