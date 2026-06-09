/**
 * sourceControlOpenGithub.test.tsx
 *
 * #34 — the Source Control panel header shows the configured repo name with
 * an "Open in GitHub" external-link button. Hidden when no repo is
 * configured. The link omits the /tree/<branch> suffix for default branches
 * (main/master) and includes it otherwise.
 *
 * idb-keyval is mocked so the Zustand persist middleware doesn't hit
 * IndexedDB (unavailable in jsdom). token is left null so RecentCommits
 * skips its network fetch.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { SourceControlPanel } from '../components/sidebar/SourceControlPanel'
import { useNoteStore } from '../stores/noteStore'
import { useGitHubStore } from '../stores/githubStore'
import type { SyncRepo } from '../types'

function setRepo(repo: SyncRepo | null) {
  useGitHubStore.setState({ syncRepo: repo, token: null, lastCommitSha: null, lastSyncedAt: null })
}

beforeEach(() => {
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  setRepo(null)
})

describe('Source Control "Open in GitHub" (#34)', () => {
  test('hidden when no repo is configured', () => {
    render(<SourceControlPanel />)
    expect(screen.queryByTestId('source-control-open-github')).not.toBeInTheDocument()
    expect(screen.queryByTestId('source-control-repo-name')).not.toBeInTheDocument()
  })

  test('shows repo name + link to repo root for a default branch', () => {
    setRepo({ owner: 'ipapakonstantinou', name: 'noteser', branch: 'main', isPrivate: false })
    render(<SourceControlPanel />)
    expect(screen.getByTestId('source-control-repo-name')).toHaveTextContent('ipapakonstantinou/noteser')
    const link = screen.getByTestId('source-control-open-github')
    expect(link).toHaveAttribute('href', 'https://github.com/ipapakonstantinou/noteser')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('data-noteser-tip', 'Open in GitHub')
  })

  test('appends /tree/<branch> for a non-default branch', () => {
    setRepo({ owner: 'o', name: 'r', branch: 'dev', isPrivate: true })
    render(<SourceControlPanel />)
    expect(screen.getByTestId('source-control-open-github')).toHaveAttribute(
      'href',
      'https://github.com/o/r/tree/dev',
    )
  })
})
