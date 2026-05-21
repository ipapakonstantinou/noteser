/**
 * featureTourNote.test.ts
 *
 * Coverage for the Feature-tour seed helper. We assert:
 *   - first call creates the note at vault root + opens it
 *   - second call finds the existing note (no duplicate)
 *   - migrates a legacy in-folder Feature tour note back to root
 *   - dedupes when the vault has multiple Feature tour notes
 *   - a soft-deleted tour note doesn't block a fresh seed
 *   - body uses vault-relative `Files/feature-tour/X.png` paths
 *     (NOT remote URLs, NOT Tutorial/)
 *   - image attachments get fetched from /feature-tour/X.png and
 *     saved under `Files/feature-tour/X.png`
 */

import {
  seedFeatureTourNote,
  buildFeatureTourBody,
  tourAssetPath,
  FEATURE_TOUR_TITLE,
  TUTORIAL_IMAGES,
} from '../utils/featureTourNote'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

// Mock the attachments module so we don't hit IDB; just capture which
// paths got putAttachmentAtPath'd.
jest.mock('../utils/attachments', () => {
  const seen = new Map<string, Blob>()
  return {
    putAttachmentAtPath: jest.fn(async (path: string, blob: Blob) => {
      seen.set(path, blob)
    }),
    getAttachmentBlob: jest.fn(async (path: string) => seen.get(path) ?? null),
    __seen: seen,
    __reset: () => seen.clear(),
  }
})
import * as attachmentsMock from '../utils/attachments'

const stubFetch = () => {
  const okBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
  global.fetch = jest.fn(async () => ({
    ok: true,
    blob: async () => okBlob,
  })) as unknown as typeof fetch
}

beforeEach(() => {
  ;(attachmentsMock as unknown as { __reset: () => void }).__reset()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null })
  useWorkspaceStore.setState({
    panes: [{ id: 'p1', tabs: [], activeTabId: null }],
    activePaneId: 'p1',
    mergeAppliedCount: 0,
  })
  stubFetch()
})

test('first call creates the Feature tour note at vault root and opens it', async () => {
  const id = await seedFeatureTourNote()

  const { notes, selectedNoteId } = useNoteStore.getState()
  expect(notes).toHaveLength(1)
  expect(notes[0].id).toBe(id)
  expect(notes[0].title).toBe(FEATURE_TOUR_TITLE)
  // At the vault root — no folder.
  expect(notes[0].folderId).toBeNull()
  expect(notes[0].content).toBe(buildFeatureTourBody())
  expect(selectedNoteId).toBe(id)

  // Opened as a pinned (not preview) tab in the active pane.
  const { panes } = useWorkspaceStore.getState()
  expect(panes[0].tabs).toHaveLength(1)
  expect(panes[0].tabs[0]).toMatchObject({ kind: 'note', noteId: id, isPreview: false })
})

test('second call finds the existing note (no duplicate)', async () => {
  const firstId = await seedFeatureTourNote()
  const secondId = await seedFeatureTourNote()

  expect(secondId).toBe(firstId)
  expect(useNoteStore.getState().notes).toHaveLength(1)
})

test('migrates a Feature tour note out of any subfolder back to root', async () => {
  // Simulate the previous seed version that put the note in Tutorial/.
  useFolderStore.setState({
    folders: [{
      id: 'tutorial-folder',
      name: 'Tutorial',
      parentId: null,
      createdAt: 0,
      updatedAt: 0,
      isDeleted: false,
      deletedAt: null,
      order: 0,
    }],
    activeFolderId: null,
  })
  useNoteStore.setState({
    notes: [{
      id: 'in-tutorial',
      title: FEATURE_TOUR_TITLE,
      content: 'stale content',
      folderId: 'tutorial-folder',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isDeleted: false,
      deletedAt: null,
      isPinned: false,
      templateId: null,
    }],
    selectedNoteId: null,
  })

  const id = await seedFeatureTourNote()
  expect(id).toBe('in-tutorial')
  const migrated = useNoteStore.getState().notes[0]
  expect(migrated.folderId).toBeNull()
  expect(migrated.content).toBe(buildFeatureTourBody())
})

test('dedupes when the vault has multiple Feature tour notes', async () => {
  const now = Date.now()
  useFolderStore.setState({
    folders: [{
      id: 'old-tutorial',
      name: 'Tutorial',
      parentId: null,
      createdAt: 0,
      updatedAt: 0,
      isDeleted: false,
      deletedAt: null,
      order: 0,
    }],
    activeFolderId: null,
  })
  useNoteStore.setState({
    notes: [
      {
        id: 'root-recent',
        title: FEATURE_TOUR_TITLE,
        content: 'root content',
        folderId: null,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      },
      {
        id: 'tutorial-older',
        title: FEATURE_TOUR_TITLE,
        content: 'tutorial content',
        folderId: 'old-tutorial',
        createdAt: now - 1000,
        updatedAt: now - 1000,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      },
    ],
    selectedNoteId: null,
  })

  const id = await seedFeatureTourNote()

  // Root one wins — it's already at the desired location.
  expect(id).toBe('root-recent')
  const active = useNoteStore.getState().notes.filter(n => !n.isDeleted)
  expect(active).toHaveLength(1)
  expect(active[0].id).toBe('root-recent')
  expect(active[0].content).toBe(buildFeatureTourBody())
  const tutorialNote = useNoteStore.getState().notes.find(n => n.id === 'tutorial-older')
  expect(tutorialNote?.isDeleted).toBe(true)
})

test('a soft-deleted Feature tour note does NOT block creating a fresh one', async () => {
  const firstId = await seedFeatureTourNote()
  useNoteStore.setState(state => ({
    notes: state.notes.map(n => n.id === firstId ? { ...n, isDeleted: true, deletedAt: Date.now() } : n),
  }))

  const secondId = await seedFeatureTourNote()
  expect(secondId).not.toBe(firstId)
  expect(useNoteStore.getState().notes.filter(n => !n.isDeleted)).toHaveLength(1)
})

test('body uses Files/feature-tour/ attachment paths, not remote URLs and not Tutorial/', () => {
  const body = buildFeatureTourBody()
  expect(body).not.toContain('https://raw.githubusercontent.com')
  expect(body).not.toContain('Tutorial/')
  expect(body).not.toMatch(/!\[[^\]]*\]\(https?:\/\//)

  const matches = body.match(/!\[[^\]]*\]\(([^)]+)\)/g) ?? []
  expect(matches.length).toBeGreaterThanOrEqual(9)
  for (const m of matches) {
    // Each image points at Files/feature-tour/<filename>
    expect(m).toMatch(/\(Files\/feature-tour\//)
  }
})

test('seeds attachments at Files/feature-tour/<filename>', async () => {
  await seedFeatureTourNote()
  await new Promise(r => setTimeout(r, 50))

  for (const filename of TUTORIAL_IMAGES) {
    const expectedPath = tourAssetPath(filename)
    expect(expectedPath).toBe(`Files/feature-tour/${filename}`)
    expect(attachmentsMock.putAttachmentAtPath).toHaveBeenCalledWith(
      expectedPath,
      expect.any(Blob),
      filename,
    )
  }
})

test('skips re-fetching images that are already seeded', async () => {
  await seedFeatureTourNote()
  await new Promise(r => setTimeout(r, 50))
  const firstCallCount = (attachmentsMock.putAttachmentAtPath as jest.Mock).mock.calls.length

  await seedFeatureTourNote()
  await new Promise(r => setTimeout(r, 50))
  expect((attachmentsMock.putAttachmentAtPath as jest.Mock).mock.calls.length).toBe(firstCallCount)
})
