/**
 * @jest-environment jsdom
 *
 * switchVaultFreshClone.test.ts — covers the "discard on repo switch" behavior.
 *
 * PRODUCT DECISION: we do not keep repos cached in the browser. When the user
 * switches to a DIFFERENT repo (repo-to-repo) in GitHubRepoModal, the target
 * repo's cached per-repo vault is DISCARDED and re-cloned fresh from the remote.
 * This fixes a sync failure when switching to a repo whose cached per-repo data
 * was corrupted by an earlier duplication bug.
 *
 * CRITICAL CONSTRAINT: this must NOT affect RELOAD of the same repo. The
 * startup pull (runPull) loads the per-repo vault from cache via
 * `switchVault(repo, { carryOver: false })` (no freshClone) — that path must
 * keep loading the cache, not clone fresh. Only a user-initiated repo SWITCH
 * passes freshClone.
 *
 * The first two tests call the REAL switchVault with idb-keyval mocked, so they
 * assert directly that freshClone deletes the keys + resets memory, while the
 * plain carryOver:false path loads the cache (does NOT delete). The third test
 * mocks switchVault and drives GitHubRepoModal.commitSwitch to assert the
 * option object passed for repo-to-repo vs first-connection.
 */

// idb-keyval mock — shared across the real-switchVault tests below. get()
// returns whatever the test stages; set/del are spies.
const idbStore = new Map<string, unknown>()
const idbGetMock = jest.fn((key: string) => Promise.resolve(idbStore.get(key)))
const idbSetMock = jest.fn((key: string, val: unknown) => {
  idbStore.set(key, val)
  return Promise.resolve()
})
const idbDelMock = jest.fn((key: string) => {
  idbStore.delete(key)
  return Promise.resolve()
})
jest.mock('idb-keyval', () => ({
  get: (key: string) => idbGetMock(key),
  set: (key: string, val: unknown) => idbSetMock(key, val),
  del: (key: string) => idbDelMock(key),
  keys: jest.fn().mockResolvedValue([]),
}))

import { switchVault } from '../utils/switchVault'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { notesKey, foldersKey } from '../utils/repoStorage'
import type { Note, Folder, SyncRepo } from '../types'

const REPO_A: SyncRepo = { owner: 'octocat', name: 'vault-a', branch: 'main', isPrivate: false }
const REPO_B: SyncRepo = { owner: 'octocat', name: 'vault-b', branch: 'main', isPrivate: false }

const makeNote = (id: string): Note => ({
  id,
  title: id,
  content: 'stale',
  folderId: null,
  createdAt: 1,
  updatedAt: 1,
  isDeleted: false,
  deletedAt: null,
  isPinned: false,
  templateId: null,
})

const makeFolder = (id: string): Folder => ({
  id,
  name: id,
  parentId: null,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  isDeleted: false,
  deletedAt: null,
})

// A persisted Zustand-shaped blob (idbStorage stores the JSON string the
// persist middleware produces, but switchVault only checks presence via
// idbGet, so any defined value stands in for "this key has data").
const PERSISTED_BLOB = JSON.stringify({ state: {}, version: 2 })

beforeEach(() => {
  idbStore.clear()
  idbGetMock.mockClear()
  idbSetMock.mockClear()
  idbDelMock.mockClear()
  // Start each test pointed at REPO_A's key with some in-memory data, so a
  // switch to REPO_B is a genuine repo-to-repo move.
  useNoteStore.persist.setOptions({ name: notesKey(REPO_A) })
  useFolderStore.persist.setOptions({ name: foldersKey(REPO_A) })
  useNoteStore.setState({ notes: [makeNote('a1')], selectedNoteId: 'a1' })
  useFolderStore.setState({
    folders: [makeFolder('fa1')],
    activeFolderId: 'fa1',
    expandedFolders: { fa1: true },
  })
})

describe('switchVault freshClone', () => {
  test('freshClone:true with stale target cache → deletes target keys, resets memory, points at target', async () => {
    // REPO_B's per-repo keys hold STALE data (the corrupted cache we want gone).
    idbStore.set(notesKey(REPO_B), PERSISTED_BLOB)
    idbStore.set(foldersKey(REPO_B), PERSISTED_BLOB)

    await switchVault(REPO_B, { freshClone: true })

    // Both per-repo keys for the TARGET were deleted (so no stale data survives).
    expect(idbDelMock).toHaveBeenCalledWith(notesKey(REPO_B))
    expect(idbDelMock).toHaveBeenCalledWith(foldersKey(REPO_B))

    // In-memory stores reset to empty so the next sync clones fresh.
    expect(useNoteStore.getState().notes).toEqual([])
    expect(useNoteStore.getState().selectedNoteId).toBeNull()
    expect(useFolderStore.getState().folders).toEqual([])
    expect(useFolderStore.getState().activeFolderId).toBeNull()
    expect(useFolderStore.getState().expandedFolders).toEqual({})

    // Persist names point at the target.
    expect(useNoteStore.persist.getOptions().name).toBe(notesKey(REPO_B))
    expect(useFolderStore.persist.getOptions().name).toBe(foldersKey(REPO_B))

    // freshClone is mutually exclusive with carryOver — we never copy data in.
    expect(idbSetMock).not.toHaveBeenCalled()
  })

  test('carryOver:false (no freshClone) → loads target cache, does NOT delete (reload/#20-guard path)', async () => {
    // REPO_B's per-repo keys hold REAL data this repo should load on reload.
    idbStore.set(notesKey(REPO_B), PERSISTED_BLOB)
    idbStore.set(foldersKey(REPO_B), PERSISTED_BLOB)

    await switchVault(REPO_B, { carryOver: false })

    // The cache was NOT deleted — this is the reload / runPull-guard behavior.
    expect(idbDelMock).not.toHaveBeenCalled()

    // Persist names point at the target so the cache rehydrates into the store.
    expect(useNoteStore.persist.getOptions().name).toBe(notesKey(REPO_B))
    expect(useFolderStore.persist.getOptions().name).toBe(foldersKey(REPO_B))

    // No carry-over copy when the destination already has data.
    expect(idbSetMock).not.toHaveBeenCalled()
  })
})
