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
// returns whatever the test stages; set/del are spies. keys() returns every
// staged key, so clearAllAttachments() can enumerate + delete the globally-
// keyed `noteser-attachment:*` blobs.
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
const idbKeysMock = jest.fn(() => Promise.resolve(Array.from(idbStore.keys())))
jest.mock('idb-keyval', () => ({
  get: (key: string) => idbGetMock(key),
  set: (key: string, val: unknown) => idbSetMock(key, val),
  del: (key: string) => idbDelMock(key),
  keys: () => idbKeysMock(),
}))

import { switchVault } from '../utils/switchVault'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useGitHubStore } from '../stores/githubStore'
import { useSettingsStore } from '../stores/settingsStore'
import { notesKey, foldersKey } from '../utils/repoStorage'
import { STORAGE_KEYS } from '../utils/storageKeys'
import type { Note, Folder, SyncRepo } from '../types'

const ATT_PREFIX = STORAGE_KEYS.attachmentPrefix
const TOMBSTONE_KEY = STORAGE_KEYS.attachmentTombstones

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
  idbKeysMock.mockClear()
  // Start each test pointed at REPO_A's key with some in-memory data, so a
  // switch to REPO_B is a genuine repo-to-repo move.
  useNoteStore.persist.setOptions({ name: notesKey(REPO_A) })
  useFolderStore.persist.setOptions({ name: foldersKey(REPO_A) })
  useNoteStore.setState({ notes: [makeNote('a1')], selectedNoteId: 'a1' })
  useFolderStore.setState({
    folders: [makeFolder('fa1')],
    activeFolderId: 'fa1',
    expandedFolders: { fa1: true },
    // Repo A's deleted-folder tombstones. These are per-repo but live in the
    // in-memory folder store, so a switch must clear them — otherwise they
    // suppress the same directories on the NEXT repo's first pull.
    deletedFolderPaths: ['.obsidian', 'Archive'],
  })
  // REPO_A's per-sync bookkeeping is global (not per-repo). Seed stale values
  // so we can assert the freshClone path zeroes them out — and that the
  // non-freshClone path leaves them alone.
  useGitHubStore.setState({ lastCommitSha: 'sha-from-repo-a', lastSyncedAt: 12345 })
  useSettingsStore.setState({
    vaultSettingsUpdatedAt: 999,
    vaultSettingsLastPushedHash: 'hash-from-repo-a',
    vaultGitignoreDraft: 'node_modules/',
    vaultGitignoreRemoteSnapshot: '.DS_Store',
    localGitignoreOverlay: 'scratch/',
    vaultEncryptionEnabled: true,
    vaultEncryptionSalt: 'salt-a',
    vaultEncryptionCanary: 'canary-a',
  })
  // Stage two attachment blobs + a tombstone list under the GLOBAL prefix,
  // mimicking the "165 files left behind" leak.
  idbStore.set(`${ATT_PREFIX}Files/img-1.png`, { blob: {}, mime: 'image/png' })
  idbStore.set(`${ATT_PREFIX}Files/img-2.png`, { blob: {}, mime: 'image/png' })
  idbStore.set(TOMBSTONE_KEY, ['Files/deleted.png'])
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

    // ALL globally-keyed attachment blobs were deleted (they are NOT per-repo,
    // so a notes/folders reset alone would leave them behind).
    expect(idbDelMock).toHaveBeenCalledWith(`${ATT_PREFIX}Files/img-1.png`)
    expect(idbDelMock).toHaveBeenCalledWith(`${ATT_PREFIX}Files/img-2.png`)
    // The tombstone list was deleted too.
    expect(idbDelMock).toHaveBeenCalledWith(TOMBSTONE_KEY)
    // No attachment key survives in storage.
    const survivingAttachmentKeys = Array.from(idbStore.keys()).filter(
      k => k.startsWith(ATT_PREFIX) || k === TOMBSTONE_KEY,
    )
    expect(survivingAttachmentKeys).toEqual([])

    // In-memory stores reset to empty so the next sync clones fresh.
    expect(useNoteStore.getState().notes).toEqual([])
    expect(useNoteStore.getState().selectedNoteId).toBeNull()
    expect(useFolderStore.getState().folders).toEqual([])
    expect(useFolderStore.getState().activeFolderId).toBeNull()
    expect(useFolderStore.getState().expandedFolders).toEqual({})
    // Repo A's deleted-folder tombstones must NOT leak into repo B.
    expect(useFolderStore.getState().deletedFolderPaths).toEqual([])

    // githubStore last-sync pointers reset; connection (token/user/syncRepo) untouched.
    expect(useGitHubStore.getState().lastCommitSha).toBeNull()
    expect(useGitHubStore.getState().lastSyncedAt).toBeNull()

    // settingsStore per-vault sync state reset to initial values.
    expect(useSettingsStore.getState().vaultSettingsUpdatedAt).toBe(0)
    expect(useSettingsStore.getState().vaultSettingsLastPushedHash).toBe('')
    expect(useSettingsStore.getState().vaultGitignoreDraft).toBeNull()
    expect(useSettingsStore.getState().vaultGitignoreRemoteSnapshot).toBeNull()
    expect(useSettingsStore.getState().localGitignoreOverlay).toBe('')
    expect(useSettingsStore.getState().vaultEncryptionEnabled).toBe(false)
    expect(useSettingsStore.getState().vaultEncryptionSalt).toBeNull()
    expect(useSettingsStore.getState().vaultEncryptionCanary).toBeNull()

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

    // Attachments are UNTOUCHED on the reload path — switching persist keys
    // must not wipe the globally-keyed binaries the same repo just loaded.
    expect(idbStore.has(`${ATT_PREFIX}Files/img-1.png`)).toBe(true)
    expect(idbStore.has(`${ATT_PREFIX}Files/img-2.png`)).toBe(true)
    expect(idbStore.has(TOMBSTONE_KEY)).toBe(true)

    // Per-sync bookkeeping is left intact on reload (no clean-slate reset).
    expect(useGitHubStore.getState().lastCommitSha).toBe('sha-from-repo-a')
    expect(useGitHubStore.getState().lastSyncedAt).toBe(12345)
    expect(useSettingsStore.getState().vaultEncryptionSalt).toBe('salt-a')
    expect(useSettingsStore.getState().vaultGitignoreDraft).toBe('node_modules/')

    // Persist names point at the target so the cache rehydrates into the store.
    expect(useNoteStore.persist.getOptions().name).toBe(notesKey(REPO_B))
    expect(useFolderStore.persist.getOptions().name).toBe(foldersKey(REPO_B))

    // No carry-over copy when the destination already has data.
    expect(idbSetMock).not.toHaveBeenCalled()
  })

  test('carryOver:false with EMPTY target → resets memory incl. deletedFolderPaths (no tombstone leak)', async () => {
    // REPO_B has no cached data, so switchVault takes the explicit reset branch
    // (rehydrate alone can't clear in-memory state when storage is empty). The
    // reset must zero deletedFolderPaths too, or repo A's tombstones would
    // silently suppress directories on repo B's first pull.
    // (idbStore has no REPO_B keys staged → idbGet returns undefined.)

    await switchVault(REPO_B, { carryOver: false })

    expect(useNoteStore.getState().notes).toEqual([])
    expect(useFolderStore.getState().folders).toEqual([])
    expect(useFolderStore.getState().activeFolderId).toBeNull()
    expect(useFolderStore.getState().expandedFolders).toEqual({})
    expect(useFolderStore.getState().deletedFolderPaths).toEqual([])

    // Persist names still point at the target.
    expect(useNoteStore.persist.getOptions().name).toBe(notesKey(REPO_B))
    expect(useFolderStore.persist.getOptions().name).toBe(foldersKey(REPO_B))
  })
})
