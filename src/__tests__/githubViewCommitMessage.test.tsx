/**
 * githubViewCommitMessage.test.tsx
 *
 * #176 — the Source Control commit-message box must show the RESOLVED
 * default template (today's date), never the literal `{{date}}`. Also
 * locks in that the message passed to runSync is expanded, covering a
 * `{{date}}` the user types by hand.
 *
 * idb-keyval is mocked for the Zustand persist middleware; `@/hooks` is
 * mocked (minimal surface GitHubView imports) so no sync machinery runs;
 * token stays null so RecentCommits skips its network fetch.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

const runSyncMock = jest.fn()
const runPullOnlyMock = jest.fn()
jest.mock('../hooks', () => ({
  useGitHubSync: () => ({
    runSync: runSyncMock,
    runPullOnly: runPullOnlyMock,
    syncState: { kind: 'idle' },
    isConnected: true,
  }),
  useHydration: () => true,
}))

import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { GitHubView } from '../components/sidebar/GitHubView'
import { useGitHubStore } from '../stores/githubStore'
import { useNoteStore } from '../stores/noteStore'
import { useSettingsStore } from '../stores/settingsStore'
import { formatDate } from '../utils/dateFormat'
import type { SyncRepo } from '../types'

const USER = { id: 1, login: 'octocat', name: null, avatar_url: '' }
const REPO: SyncRepo = { owner: 'octocat', name: 'vault', branch: 'main', isPrivate: true }

beforeEach(() => {
  runSyncMock.mockReset()
  runPullOnlyMock.mockReset()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  // token null → RecentCommits inside SourceControlPanel skips its fetch.
  useGitHubStore.setState({
    user: USER, syncRepo: REPO, token: null,
    lastCommitSha: null, lastSyncedAt: null, isSyncing: false,
  })
  useSettingsStore.setState({ defaultCommitMessage: 'Sync from Noteser ({{date}})' })
})

describe('GitHubView commit-message box (#176)', () => {
  test('seeds the textarea with the template EXPANDED — no literal {{date}}', () => {
    render(<GitHubView />)
    const box = screen.getByTestId('scm-message') as HTMLTextAreaElement
    const today = formatDate(new Date(), 'YYYY-MM-DD')
    expect(box.value).toBe(`Sync from Noteser (${today})`)
    expect(box.value).not.toContain('{{date}}')
  })

  test('a hand-typed {{date}} is still expanded at commit time', () => {
    render(<GitHubView />)
    const box = screen.getByTestId('scm-message')
    fireEvent.change(box, { target: { value: 'manual backup {{date}}' } })
    fireEvent.click(screen.getByTestId('scm-commit-button'))

    const today = formatDate(new Date(), 'YYYY-MM-DD')
    expect(runSyncMock).toHaveBeenCalledTimes(1)
    expect(runSyncMock).toHaveBeenCalledWith(`manual backup ${today}`)
  })

  test('a cleared box falls through to runSync(undefined) (auto-generated default)', () => {
    render(<GitHubView />)
    const box = screen.getByTestId('scm-message')
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('scm-commit-button'))
    expect(runSyncMock).toHaveBeenCalledWith(undefined)
  })
})
