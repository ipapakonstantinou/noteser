/**
 * @jest-environment jsdom
 *
 * githubRepoModalHostBlind.test.tsx — asserts GitHubRepoModal fetches and
 * creates repos through the active host's provider (makeGitHostProvider),
 * not the GitHub-specific listUserRepos.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { GitHubRepoModal } from '../components/modals/GitHubRepoModal'
import { useUIStore, useGitHubStore } from '../stores'

const listRepos = jest.fn()
const createRepo = jest.fn()
const makeGitHostProvider = jest.fn()
jest.mock('../utils/gitHost', () => ({
  makeGitHostProvider: (...args: unknown[]) => makeGitHostProvider(...args)
}))

const switchVaultMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../utils/switchVault', () => ({
  switchVault: (...args: unknown[]) => switchVaultMock(...args)
}))

const runSyncMock = jest.fn().mockResolvedValue(undefined)
jest.mock('../hooks/useGitHubSync', () => ({
  useGitHubSync: () => ({ runSync: runSyncMock })
}))

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([])
}))

beforeEach(() => {
  listRepos.mockReset()
  createRepo.mockReset()
  switchVaultMock.mockClear()
  runSyncMock.mockClear()
  makeGitHostProvider.mockClear().mockReturnValue({ listRepos, createRepo })
  useGitHubStore.setState({
    token: 'pat-x',
    host: 'forgejo',
    baseUrl: 'https://codeberg.org',
    syncRepo: null
  })
  useUIStore.setState({ modal: { type: 'github-repo' } })
})

it('lists repos through the active host provider', async () => {
  listRepos.mockResolvedValueOnce([
    { owner: 'cberg', name: 'vault', defaultBranch: 'main', isPrivate: true }
  ])
  render(<GitHubRepoModal />)
  await waitFor(() =>
    expect(screen.getByText('cberg/vault')).toBeInTheDocument()
  )
  expect(makeGitHostProvider).toHaveBeenCalledWith(
    expect.objectContaining({
      host: 'forgejo',
      token: 'pat-x',
      baseUrl: 'https://codeberg.org'
    })
  )
})

it('calls provider.createRepo with the correct (name, isPrivate) args', async () => {
  listRepos.mockResolvedValueOnce([])
  createRepo.mockResolvedValueOnce({
    owner: 'cberg',
    name: 'my-vault',
    defaultBranch: 'main',
    isPrivate: true
  })

  render(<GitHubRepoModal />)

  // Wait for the list view to render (empty list is fine)
  await waitFor(() => expect(screen.getByText('New repo')).toBeInTheDocument())

  // Navigate to the create form
  fireEvent.click(screen.getByText('New repo'))

  // Change the repo name from the default
  const nameInput = screen.getByPlaceholderText('noteser-vault')
  fireEvent.change(nameInput, { target: { value: 'my-vault' } })

  // Private checkbox is checked by default — leave it as-is (isPrivate: true)
  fireEvent.click(screen.getByText(/Create & Use/))

  await waitFor(() => expect(createRepo).toHaveBeenCalledTimes(1))
  expect(createRepo).toHaveBeenCalledWith('my-vault', true)
})
