/**
 * sourceControlHostGating.test.tsx
 *
 * Tests for the host gating of RecentCommits component in SourceControlPanel:
 *   - Hidden when host is not 'github'.
 *   - Visible when host is 'github' and token + repo are set.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([])
}))

jest.mock('../utils/githubHistory', () => ({
  listRecentCommits: jest.fn().mockResolvedValue([]),
  formatRelativeAuthorDate: () => 'now'
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { SourceControlPanel } from '../components/sidebar/SourceControlPanel'
import { useGitHubStore } from '../stores/githubStore'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'

beforeEach(() => {
  useGitHubStore.setState({
    token: null,
    user: null,
    syncRepo: null,
    lastCommitSha: null,
    lastSyncedAt: null,
    host: 'github',
    baseUrl: 'https://github.com'
  })
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useFolderStore.setState({ folders: [], activeFolderId: null })
})

describe('SourceControlPanel — repo web link host routing', () => {
  test('forgejo link uses the Codeberg base URL, not github.com', () => {
    useGitHubStore.setState({
      token: 'pat-x',
      host: 'forgejo',
      baseUrl: 'https://codeberg.org',
      syncRepo: {
        owner: 'cberg',
        name: 'vault',
        branch: 'main',
        isPrivate: true
      },
      lastCommitSha: null
    })
    render(<SourceControlPanel />)
    const link = screen.getByTestId('source-control-open-github')
    expect(link.getAttribute('href')).toMatch(
      /^https:\/\/codeberg\.org\/cberg\/vault/
    )
    expect(link.getAttribute('href')).not.toContain('github.com')
  })

  test('github link uses github.com (unchanged behavior)', () => {
    useGitHubStore.setState({
      token: 'ghp_x',
      host: 'github',
      baseUrl: 'https://github.com',
      syncRepo: {
        owner: 'owner',
        name: 'repo',
        branch: 'main',
        isPrivate: false
      },
      lastCommitSha: null
    })
    render(<SourceControlPanel />)
    const link = screen.getByTestId('source-control-open-github')
    expect(link.getAttribute('href')).toMatch(
      /^https:\/\/github\.com\/owner\/repo/
    )
  })
})

describe('SourceControlPanel — RecentCommits host gating', () => {
  test('hides recent commits on a non-GitHub host', () => {
    useGitHubStore.setState({
      token: 'pat-x',
      host: 'forgejo',
      baseUrl: 'https://codeberg.org',
      syncRepo: {
        owner: 'c',
        name: 'v',
        branch: 'main',
        isPrivate: true
      },
      lastCommitSha: null
    })
    render(<SourceControlPanel />)
    expect(
      screen.queryByTestId('source-control-recent-commits')
    ).not.toBeInTheDocument()
  })

  test('shows recent commits on GitHub host when token and repo are set', () => {
    useGitHubStore.setState({
      token: 'ghp_x',
      host: 'github',
      syncRepo: {
        owner: 'owner',
        name: 'repo',
        branch: 'main',
        isPrivate: false
      },
      lastCommitSha: null
    })
    render(<SourceControlPanel />)
    expect(
      screen.getByTestId('source-control-recent-commits')
    ).toBeInTheDocument()
  })
})
