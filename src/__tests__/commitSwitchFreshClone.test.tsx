/**
 * @jest-environment jsdom
 *
 * commitSwitchFreshClone.test.tsx — asserts GitHubRepoModal passes the right
 * switchVault options for the "discard on repo switch" behavior:
 *
 *   - repo-to-repo switch  → switchVault(target, { carryOver:false, freshClone:true })
 *     (discard the target's stale cache, re-clone fresh)
 *   - first connection     → switchVault(target, { carryOver:true,  freshClone:false })
 *     (seed the new vault from local notes — must NOT freshClone)
 *
 * We mock switchVault at the module boundary and assert the option object,
 * rather than driving the real IDB delete (covered by switchVaultFreshClone).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

const switchVaultMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../utils/switchVault', () => ({
  switchVault: (...args: unknown[]) => switchVaultMock(...args),
}))

const listUserReposMock = jest.fn()
const createRepoMock = jest.fn()
jest.mock('../utils/github', () => ({
  listUserRepos: (...args: unknown[]) => listUserReposMock(...args),
  createRepo: (...args: unknown[]) => createRepoMock(...args),
}))

const runSyncMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../hooks/useGitHubSync', () => ({
  useGitHubSync: () => ({ runSync: runSyncMock }),
}))

// No unpushed changes — keeps handlePick on the direct commitSwitch path
// instead of the confirm-switch dialog.
jest.mock('../utils/dirtyState', () => ({
  getUnpushedChangeCount: jest.fn().mockReturnValue(0),
  discardUnpushedChanges: jest.fn(),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GitHubRepoModal } from '../components/modals/GitHubRepoModal'
import { useUIStore } from '../stores/uiStore'
import { useGitHubStore } from '../stores/githubStore'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import type { GitHubRepo, SyncRepo } from '../types'

const REPO_A: SyncRepo = { owner: 'octocat', name: 'vault-a', branch: 'main', isPrivate: false }

const REMOTE_B: GitHubRepo = {
  id: 2,
  name: 'vault-b',
  full_name: 'octocat/vault-b',
  owner: { login: 'octocat' },
  private: false,
  default_branch: 'main',
  updated_at: '2024-01-01T00:00:00Z',
}

function setGitHub(syncRepo: SyncRepo | null) {
  useGitHubStore.setState({
    token: 'tok',
    user: { login: 'octocat', avatar_url: '', name: null, id: 1 },
    connectedAt: Date.now(),
    syncRepo,
    lastSyncedAt: null,
    lastCommitSha: null,
    repoSyncStates: {},
    isSyncing: false,
    host: 'github',
    baseUrl: null,
  })
}

beforeEach(() => {
  switchVaultMock.mockClear()
  runSyncMock.mockClear()
  listUserReposMock.mockReset().mockResolvedValue([REMOTE_B])
  useUIStore.getState().openModal({ type: 'github-repo' })
  // Some in-memory data so vaultIsEmpty() is false on the first-connection
  // assertion (we only care about the switchVault args here).
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
})

afterEach(() => {
  useUIStore.getState().closeModal()
})

test('repo-to-repo switch passes freshClone:true (discard target cache, re-clone fresh)', async () => {
  setGitHub(REPO_A)
  render(<GitHubRepoModal />)

  const repoBtn = await screen.findByText('octocat/vault-b')
  fireEvent.click(repoBtn)

  await waitFor(() => expect(switchVaultMock).toHaveBeenCalledTimes(1))
  expect(switchVaultMock).toHaveBeenCalledWith(
    expect.objectContaining({ owner: 'octocat', name: 'vault-b' }),
    { carryOver: false, freshClone: true },
  )
})

test('first connection passes freshClone:false (seed from local, no discard)', async () => {
  setGitHub(null)
  render(<GitHubRepoModal />)

  const repoBtn = await screen.findByText('octocat/vault-b')
  fireEvent.click(repoBtn)

  await waitFor(() => expect(switchVaultMock).toHaveBeenCalledTimes(1))
  expect(switchVaultMock).toHaveBeenCalledWith(
    expect.objectContaining({ owner: 'octocat', name: 'vault-b' }),
    { carryOver: true, freshClone: false },
  )
})
