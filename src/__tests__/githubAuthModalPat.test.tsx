/**
 * githubAuthModalPat.test.tsx
 *
 * Tests for the alternative fine-grained PAT sign-in path added to
 * GitHubAuthModal (security finding 2). Covers:
 *   - a valid pasted token validates and stores the session via setSession
 *   - an invalid token shows an inline error and does NOT store a session
 *   - the default device-flow path is unaffected (still validates + stores)
 *
 * The GitHub user-fetch and the device-flow helpers are mocked so no real
 * HTTP calls are made.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

const mockFetchUserAndScopes = jest.fn()
const mockStartDeviceFlow = jest.fn()
const mockPollForToken = jest.fn()

jest.mock('../utils/github', () => {
  const actual = jest.requireActual('../utils/github') as typeof import('../utils/github')
  return {
    ...actual,
    fetchGitHubUserAndScopes: (...args: unknown[]) => mockFetchUserAndScopes(...args),
    startDeviceFlow: (...args: unknown[]) => mockStartDeviceFlow(...args),
    pollForToken: (...args: unknown[]) => mockPollForToken(...args),
  }
})

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { GitHubAuthModal } from '../components/modals/GitHubAuthModal'
import { useUIStore } from '../stores/uiStore'
import { useGitHubStore } from '../stores/githubStore'

const PAT = 'github_pat_validtoken123'
const USER = { id: 1, login: 'octocat', name: 'Octo Cat', avatar_url: 'https://example.com/a.png' }

function openAuthModal() {
  useUIStore.setState({ modal: { type: 'github-auth' } })
}

beforeEach(() => {
  mockFetchUserAndScopes.mockReset()
  mockStartDeviceFlow.mockReset()
  mockPollForToken.mockReset()
  useUIStore.setState({ modal: { type: null } })
  useGitHubStore.setState({ token: null, user: null, tokenScopes: null, syncRepo: null })
  // Keep the device flow "pending" by default so the auto-started poll in the
  // modal's open effect never resolves during PAT-path tests.
  mockStartDeviceFlow.mockResolvedValue({
    device_code: 'dc', user_code: 'WXYZ-1234', verification_uri: 'https://github.com/login/device',
    expires_in: 900, interval: 5,
  })
  mockPollForToken.mockImplementation(() => new Promise(() => { /* never resolves */ }))
})

describe('GitHubAuthModal — PAT sign-in path', () => {
  test('valid pasted token validates and stores the session via setSession', async () => {
    mockFetchUserAndScopes.mockResolvedValueOnce({ user: USER, scopes: null })
    openAuthModal()
    const user = userEvent.setup()
    render(<GitHubAuthModal />)

    // Let the auto-started device flow settle into its "waiting" view first,
    // then switch to the PAT sub-form (mirrors real usage and avoids racing
    // the toggle click against the device-code response).
    await screen.findByText('WXYZ-1234')
    await user.click(screen.getByTestId('github-pat-toggle'))
    await user.type(screen.getByTestId('github-pat-input'), PAT)
    await user.click(screen.getByTestId('github-pat-submit'))

    await waitFor(() => expect(mockFetchUserAndScopes).toHaveBeenCalledWith(PAT))
    await waitFor(() => {
      const state = useGitHubStore.getState()
      expect(state.token).toBe(PAT)
      expect(state.user).toEqual(USER)
    })
  })

  test('invalid token shows an inline error and does NOT store a session', async () => {
    mockFetchUserAndScopes.mockRejectedValueOnce(new Error('401 Unauthorized'))
    openAuthModal()
    const user = userEvent.setup()
    render(<GitHubAuthModal />)

    // Let the auto-started device flow settle into its "waiting" view first,
    // then switch to the PAT sub-form (mirrors real usage and avoids racing
    // the toggle click against the device-code response).
    await screen.findByText('WXYZ-1234')
    await user.click(screen.getByTestId('github-pat-toggle'))
    await user.type(screen.getByTestId('github-pat-input'), 'bad-token')
    await user.click(screen.getByTestId('github-pat-submit'))

    await waitFor(() =>
      expect(screen.getByText(/did not work — check it has Contents access/i)).toBeInTheDocument(),
    )
    expect(useGitHubStore.getState().token).toBeNull()
    expect(useGitHubStore.getState().user).toBeNull()
  })

  test('device-flow path is unaffected — it still validates and stores', async () => {
    // Override the default never-resolving poll so the device flow completes.
    // pollForToken now resolves to a full token set (refresh-token support);
    // a non-expiring device token has null refresh/expiry fields.
    mockPollForToken.mockResolvedValueOnce({
      accessToken: 'oauth_token_abc',
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    })
    mockFetchUserAndScopes.mockResolvedValueOnce({ user: USER, scopes: ['repo'] })
    openAuthModal()
    render(<GitHubAuthModal />)

    await waitFor(() => expect(mockFetchUserAndScopes).toHaveBeenCalledWith('oauth_token_abc'))
    await waitFor(() => {
      const state = useGitHubStore.getState()
      expect(state.token).toBe('oauth_token_abc')
      expect(state.user).toEqual(USER)
      expect(state.tokenScopes).toEqual(['repo'])
    })
    // The PAT toggle is not visible once the device flow has succeeded.
    expect(screen.queryByTestId('github-pat-input')).not.toBeInTheDocument()
  })
})
