/**
 * githubAuthModalHostPicker.test.tsx
 *
 * Tests for the host-selection step added to GitHubAuthModal (Task 2).
 * Covers:
 *   - the picker shows only GitHub; the gear ("Other git hosts") reveals
 *     Codeberg + Forgejo, and a non-GitHub connection opens with them shown
 *   - Codeberg PAT path: calls makeGitHostProvider, stores host + baseUrl
 *   - self-hosted Forgejo: rejects submit when base URL is missing
 */

// idb-keyval is transitively required by the stores (noteStore → idbStorage).
// Mock it so jsdom doesn't fail on missing IndexedDB.
jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([])
}))

// Provider factory is the seam we assert against.
const mockGetAuthenticatedUser = jest.fn()
jest.mock('../utils/gitHost', () => ({
  makeGitHostProvider: jest.fn(() => ({
    getAuthenticatedUser: mockGetAuthenticatedUser
  })),
  hostUserToGitHubUser: (u: {
    id: number
    login: string
    name: string | null
    avatarUrl?: string
  }) => ({
    id: u.id,
    login: u.login,
    name: u.name,
    avatar_url: u.avatarUrl ?? ''
  })
}))

// Prevent the GitHub device flow from making real HTTP calls in case
// a test accidentally triggers the github step.
jest.mock('../utils/github', () => ({
  startDeviceFlow: jest.fn(
    () =>
      new Promise(() => {
        /* never resolves */
      })
  ),
  pollForToken: jest.fn(
    () =>
      new Promise(() => {
        /* never resolves */
      })
  ),
  fetchGitHubUserAndScopes: jest.fn(
    () =>
      new Promise(() => {
        /* never resolves */
      })
  ),
  DeviceFlowError: class DeviceFlowError extends Error {
    code = 'unknown'
  }
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GitHubAuthModal } from '../components/modals/GitHubAuthModal'
import { useUIStore } from '../stores/uiStore'
import { useGitHubStore } from '../stores/githubStore'

beforeEach(() => {
  mockGetAuthenticatedUser.mockReset()
  useGitHubStore.setState({
    token: null,
    user: null,
    host: 'github',
    baseUrl: null,
    syncRepo: null
  })
  useUIStore.setState({ modal: { type: 'github-auth' } })
})

const showOtherHosts = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Other git hosts' }))

it('shows only GitHub until the gear reveals the other hosts', () => {
  render(<GitHubAuthModal />)
  expect(screen.getByTestId('host-pick-github')).toBeInTheDocument()
  expect(screen.queryByTestId('host-pick-codeberg')).not.toBeInTheDocument()
  expect(screen.queryByTestId('host-pick-forgejo')).not.toBeInTheDocument()
  const gear = screen.getByRole('button', { name: 'Other git hosts' })
  expect(gear).toHaveAttribute('aria-expanded', 'false')

  fireEvent.click(gear)
  expect(gear).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTestId('host-pick-codeberg')).toBeInTheDocument()
  expect(screen.getByTestId('host-pick-forgejo')).toBeInTheDocument()

  fireEvent.click(gear)
  expect(screen.queryByTestId('host-pick-codeberg')).not.toBeInTheDocument()
})

it('opens with the other hosts shown when the connection is not GitHub', () => {
  useGitHubStore.setState({ host: 'forgejo', baseUrl: 'https://codeberg.org' })
  render(<GitHubAuthModal />)
  expect(screen.getByTestId('host-pick-codeberg')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Other git hosts' })
  ).toHaveAttribute('aria-expanded', 'true')
})

it('connects a Codeberg vault via PAT and stores host+baseUrl', async () => {
  mockGetAuthenticatedUser.mockResolvedValueOnce({
    id: 9,
    login: 'cberg',
    name: 'C',
    avatarUrl: ''
  })
  render(<GitHubAuthModal />)
  showOtherHosts()
  fireEvent.click(screen.getByTestId('host-pick-codeberg'))
  fireEvent.change(screen.getByTestId('forgejo-pat-input'), {
    target: { value: 'pat-x' }
  })
  fireEvent.click(screen.getByTestId('forgejo-pat-submit'))
  await waitFor(() => expect(useGitHubStore.getState().host).toBe('forgejo'))
  expect(useGitHubStore.getState().baseUrl).toBe('https://codeberg.org')
  expect(useGitHubStore.getState().token).toBe('pat-x')
})

it('requires a base URL for self-hosted Forgejo', async () => {
  render(<GitHubAuthModal />)
  showOtherHosts()
  fireEvent.click(screen.getByTestId('host-pick-forgejo'))
  fireEvent.change(screen.getByTestId('forgejo-pat-input'), {
    target: { value: 'pat-x' }
  })
  fireEvent.click(screen.getByTestId('forgejo-pat-submit'))
  await waitFor(() =>
    expect(screen.getByText(/enter.*server url/i)).toBeInTheDocument()
  )
  expect(mockGetAuthenticatedUser).not.toHaveBeenCalled()
})

it('rejects a base URL without an http(s) scheme', async () => {
  // The base-URL field is type="text" (not type="url") so our own regex
  // validation always runs — a type="url" input would let the browser
  // silently block submit and our inline error would never show.
  render(<GitHubAuthModal />)
  showOtherHosts()
  fireEvent.click(screen.getByTestId('host-pick-forgejo'))
  fireEvent.change(screen.getByTestId('forgejo-baseurl-input'), {
    target: { value: 'notaurl' }
  })
  fireEvent.change(screen.getByTestId('forgejo-pat-input'), {
    target: { value: 'pat-x' }
  })
  fireEvent.click(screen.getByTestId('forgejo-pat-submit'))
  await waitFor(() =>
    expect(screen.getByText(/enter.*server url/i)).toBeInTheDocument()
  )
  expect(mockGetAuthenticatedUser).not.toHaveBeenCalled()
})
