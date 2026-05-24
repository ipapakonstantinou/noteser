/**
 * @jest-environment jsdom
 *
 * syncSwitchVaultBeforeClassify.test.ts — regression guard for the
 * mass-duplicate bug caused by the startup PER-REPO vault switch race.
 *
 * ROOT CAUSE: each connected repo's vault persists under a PER-REPO IndexedDB
 * key — notesKey(repo) = "noteser-notes:<owner>/<name>". On startup the
 * note/folder stores boot pointed at the UNSCOPED base key ("noteser-notes",
 * empty). `switchVault(repo)` is fired fire-and-forget from page.tsx and only
 * LATER swaps the persist key to the per-repo key and rehydrates the real data.
 * The startup pull (useAutoSync → runPull) raced ahead of that switch: it read
 * the EMPTY base-key store, computed `isFirstClone = true`, and re-imported the
 * WHOLE vault via `pullFromZipball` as `remoteCreated` — doubling the vault on
 * every reload (on-device: firstClone=true | localNotes=0 | remoteCreated=693
 * while the per-repo key held 1.1MB → 2.2MB → 3.3MB).
 *
 * THE FIX: before reading the store / computing isFirstClone, runPull makes the
 * per-repo vault the active, loaded store:
 *
 *   if (useNoteStore.persist.getOptions().name !== notesKey(repo)) {
 *     await switchVault(repo, { carryOver: false })
 *   }
 *
 * switchVault is idempotent (no-op when already on the target key), so this is
 * a no-op on the hot path. These tests assert that ordering directly. They FAIL
 * on pre-fix code (which has no switchVault guard, so it reads the empty
 * base-key store and dispatches to pullFromZipball).
 *
 * We mock `@/utils/switchVault` so calling it flips
 * `useNoteStore.persist.getOptions().name` to the per-repo key AND populates
 * the in-memory store with the real persisted notes — simulating the rehydrate
 * that the real switchVault performs.
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

// Mock switchVault at the module boundary. The mock implementation simulates
// what the real switchVault does for the startup race: it flips the persist
// `name` to the per-repo key AND rehydrates the in-memory store from the
// per-repo data that was sitting on disk under that key.
const switchVaultMock = jest.fn()
jest.mock('../utils/switchVault', () => ({
  switchVault: (...args: unknown[]) => switchVaultMock(...args),
}))

import { renderHook, act } from '@testing-library/react'
import { useGitHubSync } from '../hooks/useGitHubSync'
import { useGitHubStore } from '../stores/githubStore'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { notesKey, foldersKey } from '../utils/repoStorage'
import type { Note, SyncRepo } from '../types'

const TEST_REPO: SyncRepo = { owner: 'octocat', name: 'vault', branch: 'main', isPrivate: false }

// The "real" persisted vault that lives under the PER-REPO key on disk. The
// switchVault mock lands these in memory when it runs.
const PERSISTED_NOTES: Note[] = [
  {
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
  },
]

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

// Force both stores onto the UNSCOPED base key — the startup boot state, BEFORE
// switchVault has run. We restore these in afterEach so other suites aren't
// affected by the mutated persist options.
function bootOnBaseKey() {
  useNoteStore.persist.setOptions({ name: notesKey(null) })
  useFolderStore.persist.setOptions({ name: foldersKey(null) })
}

beforeEach(() => {
  pullFromGitHubMock.mockReset()
  pullFromZipballMock.mockReset()
  syncToGitHubMock.mockReset()
  switchVaultMock.mockReset()
  applyNonConflictsMock
    .mockReset()
    .mockReturnValue({ created: 0, updated: 0, deleted: 0, autoMerged: 0 })
  applyAttachmentClassificationsMock
    .mockReset()
    .mockResolvedValue({ created: 0, updated: 0, failed: 0 })
  pullFromGitHubMock.mockResolvedValue({ classifications: [], latestCommitSha: 'head' })
  pullFromZipballMock.mockResolvedValue({ classifications: [], latestCommitSha: 'head' })
  // Hydration is already done in these tests — the bug under test is the
  // PER-REPO KEY race, not the rehydrate race (that one is guarded separately,
  // see syncAwaitHydration.test.ts). Report both stores hydrated so the second
  // guard (pendingStoreHydration) is a no-op and only switchVault matters.
  jest.spyOn(useNoteStore.persist, 'hasHydrated').mockReturnValue(true)
  jest.spyOn(useFolderStore.persist, 'hasHydrated').mockReturnValue(true)
  connectRepo()
})

afterEach(() => {
  jest.restoreAllMocks()
  // Leave both stores back on the base key for the next suite's clean slate.
  bootOnBaseKey()
})

describe('startup pull loads the per-repo vault (switchVault) before classifying', () => {
  test('REGRESSION: base-key store + empty memory + per-repo data → switchVault runs FIRST, incremental path taken (no mass re-import)', async () => {
    // Simulate the startup race exactly:
    //   - the store is on the UNSCOPED base key (switch hasn't run),
    //   - in-memory notes are EMPTY,
    //   - a repo IS connected and its per-repo key holds the real vault.
    bootOnBaseKey()
    useNoteStore.setState({ notes: [], selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })

    // switchVault flips the persist name to the per-repo key AND rehydrates the
    // real persisted notes into memory — exactly what the real one does.
    let switchedBeforePull = false
    switchVaultMock.mockImplementation(async () => {
      useNoteStore.persist.setOptions({ name: notesKey(TEST_REPO) })
      useFolderStore.persist.setOptions({ name: foldersKey(TEST_REPO) })
      useNoteStore.setState({ notes: PERSISTED_NOTES, selectedNoteId: null })
      switchedBeforePull = true
    })
    // Record store name AT THE TIME pullFromGitHub is invoked, to prove the
    // switch happened before classification dispatched.
    pullFromGitHubMock.mockImplementation(async () => {
      expect(switchedBeforePull).toBe(true)
      expect(useNoteStore.persist.getOptions().name).toBe(notesKey(TEST_REPO))
      return { classifications: [], latestCommitSha: 'head' }
    })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    // The per-repo vault was made active before classification.
    expect(switchVaultMock).toHaveBeenCalledTimes(1)
    expect(switchVaultMock).toHaveBeenCalledWith(TEST_REPO, { carryOver: false })

    // Because the real vault has a note, this is NOT a first clone: the
    // incremental path is taken, NOT the whole-vault zipball re-import.
    expect(pullFromZipballMock).not.toHaveBeenCalled()
    expect(pullFromGitHubMock).toHaveBeenCalledTimes(1)

    // The incremental pull saw the REHYDRATED notes, not the empty array —
    // so nothing gets mis-classified as remoteCreated (no mass re-import).
    const passedNotes = (pullFromGitHubMock.mock.calls[0][0] as { notes: Note[] }).notes
    expect(passedNotes).toHaveLength(1)
    expect(passedNotes[0].id).toBe('note-1')
  })

  test('idempotent hot path: already on the per-repo key → switchVault is NOT called again', async () => {
    // The common case after the first load: the store is ALREADY scoped to the
    // per-repo key and holds the vault. The guard must NOT call switchVault.
    useNoteStore.persist.setOptions({ name: notesKey(TEST_REPO) })
    useFolderStore.persist.setOptions({ name: foldersKey(TEST_REPO) })
    useNoteStore.setState({ notes: PERSISTED_NOTES, selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    // Hot path: no redundant switch, pull proceeds normally on the per-repo key.
    expect(switchVaultMock).not.toHaveBeenCalled()
    expect(pullFromGitHubMock).toHaveBeenCalledTimes(1)
    expect(pullFromZipballMock).not.toHaveBeenCalled()
  })

  test('genuinely empty vault on the per-repo key still takes the first-clone zipball path', async () => {
    // Already scoped to the per-repo key, but the vault really is empty (a true
    // first clone). switchVault is a no-op; the zipball fast path is correct.
    useNoteStore.persist.setOptions({ name: notesKey(TEST_REPO) })
    useFolderStore.persist.setOptions({ name: foldersKey(TEST_REPO) })
    useNoteStore.setState({ notes: [], selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    expect(switchVaultMock).not.toHaveBeenCalled()
    expect(pullFromZipballMock).toHaveBeenCalledTimes(1)
    expect(pullFromGitHubMock).not.toHaveBeenCalled()
  })
})
