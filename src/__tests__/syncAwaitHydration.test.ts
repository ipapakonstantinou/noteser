/**
 * @jest-environment jsdom
 *
 * syncAwaitHydration.test.ts — regression guard for the mass-duplicate bug.
 *
 * ROOT CAUSE: the note/folder stores persist to IndexedDB (idbStorage), which
 * rehydrates ASYNCHRONOUSLY. The startup auto-pull was gated only on component
 * mount (useHydration), so it could fire while the stores were still EMPTY.
 * `runPull` then read an empty `useNoteStore.getState().notes`, wrongly decided
 * `isFirstClone === true`, and re-imported the WHOLE remote vault as
 * `remoteCreated` via the zipball path — duplicating every note on every load.
 * (The incremental path mis-classifies an empty store the same way.)
 *
 * THE FIX (defense in depth): `runPull` calls `ensureStoresHydrated()` BEFORE
 * reading the store for classification. If a store hasn't hydrated it awaits
 * `persist.rehydrate()` first, so `isFirstClone` is only ever computed against
 * real persisted state.
 *
 * These tests assert that ordering directly. They FAIL on pre-fix code (which
 * has no ensureStoresHydrated call, so it would dispatch to pullFromZipball
 * before any rehydrate).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

const pullFromGitHubMock = jest.fn()
const pullFromZipballMock = jest.fn()
const syncToGitHubMock = jest.fn()
jest.mock('../utils/githubSync', () => ({
  pullFromGitHub: (...args: unknown[]) => pullFromGitHubMock(...args),
  pullFromZipball: (...args: unknown[]) => pullFromZipballMock(...args),
  syncToGitHub: (...args: unknown[]) => syncToGitHubMock(...args),
}))

const applyNonConflictsMock = jest.fn()
const applyAttachmentClassificationsMock = jest.fn()
jest.mock('../utils/syncApply', () => ({
  applyNonConflicts: (...args: unknown[]) => applyNonConflictsMock(...args),
  applyAttachmentClassifications: (...args: unknown[]) =>
    applyAttachmentClassificationsMock(...args),
}))

import { renderHook, act } from '@testing-library/react'
import { useGitHubSync } from '../hooks/useGitHubSync'
import { useGitHubStore } from '../stores/githubStore'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import type { Note } from '../types'
import type { SyncRepo } from '../types'

const TEST_REPO: SyncRepo = { owner: 'octocat', name: 'vault', branch: 'main', isPrivate: false }

const PERSISTED_NOTE: Note = {
  id: 'note-1',
  title: 'Existing',
  content: 'local',
  folderId: null,
  createdAt: 1,
  updatedAt: 1,
  isDeleted: false,
  deletedAt: null,
  isPinned: false,
  templateId: null,
}

function connectRepo() {
  useGitHubStore.setState({
    token: 'tok',
    user: { login: 'octocat', avatar_url: '', name: null, id: 1 },
    connectedAt: Date.now(),
    syncRepo: TEST_REPO,
    lastSyncedAt: null,
    lastCommitSha: null,
    repoSyncStates: {},
    isSyncing: false,
  })
}

beforeEach(() => {
  pullFromGitHubMock.mockReset()
  pullFromZipballMock.mockReset()
  syncToGitHubMock.mockReset()
  applyNonConflictsMock.mockReset().mockReturnValue({ created: 0, updated: 0, deleted: 0, autoMerged: 0 })
  applyAttachmentClassificationsMock.mockReset().mockResolvedValue({ created: 0, updated: 0, failed: 0 })
  // Default pull result so the apply step doesn't blow up.
  pullFromGitHubMock.mockResolvedValue({ classifications: [], latestCommitSha: 'head' })
  pullFromZipballMock.mockResolvedValue({ classifications: [], latestCommitSha: 'head' })
  connectRepo()
  jest.restoreAllMocks()
})

describe('sync waits for IndexedDB store hydration before classifying', () => {
  test('REGRESSION: an unhydrated store is rehydrated BEFORE the pull is dispatched (so it is never mistaken for an empty vault)', async () => {
    // Simulate the race: the store reports NOT yet hydrated, and in memory it
    // is empty (rehydration hasn't run). The real persisted vault has a note.
    jest.spyOn(useNoteStore.persist, 'hasHydrated').mockReturnValue(false)
    jest.spyOn(useFolderStore.persist, 'hasHydrated').mockReturnValue(true)

    // Start with an empty in-memory store (the unhydrated state). rehydrate()
    // populates it with the real persisted note — mimicking IndexedDB landing.
    useNoteStore.setState({ notes: [], selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })

    let rehydrateResolved = false
    const rehydrateSpy = jest
      .spyOn(useNoteStore.persist, 'rehydrate')
      .mockImplementation(async () => {
        // The real persisted vault lands now.
        useNoteStore.setState({ notes: [PERSISTED_NOTE], selectedNoteId: null })
        rehydrateResolved = true
      })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    // The guard must have awaited rehydrate before reading the store.
    expect(rehydrateSpy).toHaveBeenCalledTimes(1)
    expect(rehydrateResolved).toBe(true)

    // Because the real vault has a note, this is NOT a first clone: the
    // incremental path must be taken, NOT the whole-vault zipball re-import.
    expect(pullFromZipballMock).not.toHaveBeenCalled()
    expect(pullFromGitHubMock).toHaveBeenCalledTimes(1)

    // And the incremental pull saw the REHYDRATED notes, not the empty array.
    const passedNotes = (pullFromGitHubMock.mock.calls[0][0] as { notes: Note[] }).notes
    expect(passedNotes).toHaveLength(1)
    expect(passedNotes[0].id).toBe('note-1')
  })

  test('once hydrated, no extra rehydrate is forced and the pull runs normally', async () => {
    jest.spyOn(useNoteStore.persist, 'hasHydrated').mockReturnValue(true)
    jest.spyOn(useFolderStore.persist, 'hasHydrated').mockReturnValue(true)
    const rehydrateSpy = jest.spyOn(useNoteStore.persist, 'rehydrate')

    useNoteStore.setState({ notes: [PERSISTED_NOTE], selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    // Already hydrated → no forced rehydrate, incremental pull as usual.
    expect(rehydrateSpy).not.toHaveBeenCalled()
    expect(pullFromGitHubMock).toHaveBeenCalledTimes(1)
    expect(pullFromZipballMock).not.toHaveBeenCalled()
  })

  test('a genuinely empty (hydrated) vault still triggers a first clone', async () => {
    // Both stores hydrated, and after hydration there really is nothing.
    jest.spyOn(useNoteStore.persist, 'hasHydrated').mockReturnValue(true)
    jest.spyOn(useFolderStore.persist, 'hasHydrated').mockReturnValue(true)
    const rehydrateSpy = jest.spyOn(useNoteStore.persist, 'rehydrate')

    useNoteStore.setState({ notes: [], selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    // no-vercel-clone: the first clone now runs through pullFromGitHub with
    // isFirstClone=true (parallel blob prefetch) instead of the zipball proxy.
    expect(rehydrateSpy).not.toHaveBeenCalled()
    expect(pullFromZipballMock).not.toHaveBeenCalled()
    expect(pullFromGitHubMock).toHaveBeenCalledTimes(1)
    expect((pullFromGitHubMock.mock.calls[0][0] as { isFirstClone?: boolean }).isFirstClone).toBe(true)
  })
})
