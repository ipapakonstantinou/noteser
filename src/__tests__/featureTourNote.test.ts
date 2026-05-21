/**
 * featureTourNote.test.ts
 *
 * Coverage for the Feature-tour seed helper. We assert:
 *   - first call ensures the Tutorial/ folder exists, creates a new note
 *     inside it, and opens it
 *   - second call finds the existing note (no duplicate)
 *   - a soft-deleted tour note doesn't block a fresh seed
 *   - the body uses vault-relative `Tutorial/X.png` paths (NOT remote
 *     URLs) so screenshots resolve via IndexedDB attachments
 *   - image attachments get fetched from /feature-tour/X.png and saved
 *     under `Tutorial/X.png`
 *
 * Image-fetch is exercised by stubbing `global.fetch`; the
 * `putAttachmentAtPath` side-effect is asserted via a spy.
 */

import {
  seedFeatureTourNote,
  FEATURE_TOUR_TITLE,
  FEATURE_TOUR_BODY,
  TUTORIAL_FOLDER_NAME,
  TUTORIAL_IMAGES,
} from '../utils/featureTourNote'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

// Mock the attachments module so we don't hit IDB in unit tests; just
// capture which paths got putAttachmentAtPath'd.
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

test('first call ensures the Tutorial folder + creates+opens the note inside it', async () => {
  const id = await seedFeatureTourNote()

  // Folder exists.
  const folders = useFolderStore.getState().folders
  const tutorialFolder = folders.find(f => f.name === TUTORIAL_FOLDER_NAME)
  expect(tutorialFolder).toBeTruthy()

  // Note exists in that folder.
  const { notes, selectedNoteId } = useNoteStore.getState()
  expect(notes).toHaveLength(1)
  expect(notes[0].id).toBe(id)
  expect(notes[0].title).toBe(FEATURE_TOUR_TITLE)
  expect(notes[0].folderId).toBe(tutorialFolder!.id)
  expect(notes[0].content).toBe(FEATURE_TOUR_BODY)
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

test('migrates a legacy root-level Feature tour note into Tutorial/', async () => {
  // Simulate the state a user has if they clicked Feature tour BEFORE
  // the Tutorial/ folder change shipped: a note titled "Feature tour"
  // at the vault root with stale (raw GitHub URL) content.
  useNoteStore.setState({
    notes: [{
      id: 'legacy',
      title: FEATURE_TOUR_TITLE,
      content: '![old](https://raw.githubusercontent.com/foo.png)',
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

  const id = await seedFeatureTourNote()

  // Same note id — we migrated, not recreated.
  expect(id).toBe('legacy')
  // No duplicate created.
  expect(useNoteStore.getState().notes).toHaveLength(1)
  // Moved into the Tutorial folder.
  const tutorialFolder = useFolderStore.getState().folders.find(f => f.name === TUTORIAL_FOLDER_NAME)
  const migrated = useNoteStore.getState().notes[0]
  expect(migrated.folderId).toBe(tutorialFolder!.id)
  // Content refreshed to the current canonical body (no more raw GitHub URLs).
  expect(migrated.content).toBe(FEATURE_TOUR_BODY)
  expect(migrated.content).not.toContain('raw.githubusercontent.com')
})

test('dedupes when the vault has multiple Feature tour notes', async () => {
  // Simulate the state a user hits after clicking the link across
  // multiple seed-code generations: a stale root-level note AND a
  // newer-but-different note in Tutorial/. The seed should pick the
  // Tutorial/ one as canonical, refresh its content, and soft-delete
  // the root-level one.
  const now = Date.now()
  // Materialise the Tutorial folder so we can put a duplicate into it.
  const folderId = useFolderStore.getState().ensureFolderPath([TUTORIAL_FOLDER_NAME])
  useNoteStore.setState({
    notes: [
      {
        id: 'root-old',
        title: FEATURE_TOUR_TITLE,
        content: 'old root content',
        folderId: null,
        createdAt: now - 1000,
        updatedAt: now - 1000,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      },
      {
        id: 'tutorial-dup',
        title: FEATURE_TOUR_TITLE,
        content: 'tutorial dup content',
        folderId,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        deletedAt: null,
        isPinned: false,
        templateId: null,
      },
    ],
    selectedNoteId: null,
  })

  const id = await seedFeatureTourNote()

  // The one inside Tutorial/ wins — root-level note is soft-deleted.
  expect(id).toBe('tutorial-dup')
  const active = useNoteStore.getState().notes.filter(n => !n.isDeleted)
  expect(active).toHaveLength(1)
  expect(active[0].id).toBe('tutorial-dup')
  expect(active[0].content).toBe(FEATURE_TOUR_BODY)
  // Root note still in the store but flagged deleted.
  const root = useNoteStore.getState().notes.find(n => n.id === 'root-old')
  expect(root?.isDeleted).toBe(true)
})

test('a soft-deleted Feature tour note does NOT block creating a fresh one', async () => {
  const firstId = await seedFeatureTourNote()
  useNoteStore.setState(state => ({
    notes: state.notes.map(n => n.id === firstId ? { ...n, isDeleted: true, deletedAt: Date.now() } : n),
  }))

  const secondId = await seedFeatureTourNote()
  expect(secondId).not.toBe(firstId)
  expect(useNoteStore.getState().notes).toHaveLength(2)
})

test('body uses vault-relative Tutorial/ paths, not remote URLs', () => {
  // No raw.githubusercontent or any other http(s) image refs.
  expect(FEATURE_TOUR_BODY).not.toContain('https://raw.githubusercontent.com')
  expect(FEATURE_TOUR_BODY).not.toMatch(/!\[[^\]]*\]\(https?:\/\//)

  const matches = FEATURE_TOUR_BODY.match(/!\[[^\]]*\]\(([^)]+)\)/g) ?? []
  expect(matches.length).toBeGreaterThanOrEqual(9)
  for (const m of matches) {
    expect(m).toMatch(/\(Tutorial\//)
  }
})

test('seeds attachments for each image under Tutorial/<filename>', async () => {
  await seedFeatureTourNote()
  // Wait for the void-promise fan-out of image fetches to settle.
  await new Promise(r => setTimeout(r, 50))

  for (const filename of TUTORIAL_IMAGES) {
    const expectedPath = `${TUTORIAL_FOLDER_NAME}/${filename}`
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

  // Second call — every image is already in the mock store, so
  // putAttachmentAtPath should NOT fire again.
  await seedFeatureTourNote()
  await new Promise(r => setTimeout(r, 50))

  expect((attachmentsMock.putAttachmentAtPath as jest.Mock).mock.calls.length).toBe(firstCallCount)
})
