/**
 * useGitHubSync.test.ts
 *
 * Verifies the runPullOnly path:
 *   - pulls, applies non-conflicts, never pushes
 *   - opens merge tabs and bails out without pushing on conflicts
 *   - respects the global isSyncing guard against concurrent runs
 *
 * We mock the underlying utility modules (githubSync / syncApply) so the
 * hook's composition logic is the only thing exercised — no real network
 * calls, no real blob writes.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// Mock githubSync so runPull's call into pullFromGitHub/pullFromZipball and
// runPush's call into syncToGitHub never escape the test. Each test
// configures the return value as needed.
const pullFromGitHubMock = jest.fn()
const pullFromZipballMock = jest.fn()
const syncToGitHubMock = jest.fn()
jest.mock('../utils/githubSync', () => ({
  pullFromGitHub: (...args: unknown[]) => pullFromGitHubMock(...args),
  pullFromZipball: (...args: unknown[]) => pullFromZipballMock(...args),
  syncToGitHub: (...args: unknown[]) => syncToGitHubMock(...args),
}))

// Mock syncApply so we can observe whether the hook called applyNonConflicts
// (and its attachment sibling) without touching the real note store
// mutators. Applying is verified by the call count, not by inspecting any
// mutated state.
const applyNonConflictsMock = jest.fn()
const applyAttachmentClassificationsMock = jest.fn()
jest.mock('../utils/syncApply', () => ({
  applyNonConflicts: (...args: unknown[]) => applyNonConflictsMock(...args),
  applyAttachmentClassifications: (...args: unknown[]) =>
    applyAttachmentClassificationsMock(...args),
}))

import { renderHook, act } from '@testing-library/react'
import { useGitHubSync } from '../hooks/useGitHubSync'
import { useGitHubStore } from '../stores/githubStore'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { notesKey, foldersKey } from '../utils/repoStorage'
import type { SyncRepo } from '../types'

const TEST_REPO: SyncRepo = { owner: 'octocat', name: 'vault', branch: 'main', isPrivate: false }

function resetStores() {
  // These tests exercise the steady state: a connected repo whose per-repo
  // vault is already the active, loaded store. runPull now makes the per-repo
  // vault active (via switchVault) before classifying, so the store must boot
  // on the per-repo key here — otherwise the guard would fire the real
  // switchVault (idb-keyval mocked empty) and reset the seeded note away.
  useNoteStore.persist.setOptions({ name: notesKey(TEST_REPO) })
  useFolderStore.persist.setOptions({ name: foldersKey(TEST_REPO) })
  // Pre-set a non-empty note so isFirstClone === false and runPull dispatches
  // to pullFromGitHub instead of pullFromZipball.
  useNoteStore.setState({
    notes: [
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
    ],
    selectedNoteId: null,
  })
  useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })
  useWorkspaceStore.setState({
    panes: [{ id: 'pane-1', tabs: [], activeTabId: null }],
    activePaneId: 'pane-1',
    mergeAppliedCount: 0,
  })
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

beforeEach(() => {
  pullFromGitHubMock.mockReset()
  pullFromZipballMock.mockReset()
  syncToGitHubMock.mockReset()
  applyNonConflictsMock.mockReset()
  applyAttachmentClassificationsMock.mockReset()
  // Sensible defaults — individual tests override.
  applyNonConflictsMock.mockReturnValue({ created: 0, updated: 0, deleted: 0, autoMerged: 0 })
  applyAttachmentClassificationsMock.mockResolvedValue({ created: 0, updated: 0, failed: 0 })
  resetStores()
})

describe('useGitHubSync — runPullOnly', () => {
  test('pulls and applies, never pushes', async () => {
    pullFromGitHubMock.mockResolvedValue({
      classifications: [
        { kind: 'remoteCreated', path: 'a.md', remoteSha: 'sha1', remoteContent: '', tags: [], body: 'hi' },
      ],
      latestCommitSha: 'commit-sha',
    })
    applyNonConflictsMock.mockReturnValue({ created: 1, updated: 0, deleted: 0, autoMerged: 0 })

    const { result } = renderHook(() => useGitHubSync())

    await act(async () => {
      await result.current.runPullOnly()
    })

    expect(pullFromGitHubMock).toHaveBeenCalledTimes(1)
    expect(applyNonConflictsMock).toHaveBeenCalledTimes(1)
    expect(applyAttachmentClassificationsMock).toHaveBeenCalledTimes(1)
    // The key invariant: a pull-only must never push.
    expect(syncToGitHubMock).not.toHaveBeenCalled()

    expect(result.current.syncState.kind).toBe('ok')
    if (result.current.syncState.kind === 'ok') {
      expect(result.current.syncState.message).toMatch(/Pulled/)
      expect(result.current.syncState.url).toBeNull()
    }
  })

  test('reports "Up to date" when nothing changed remotely', async () => {
    pullFromGitHubMock.mockResolvedValue({
      classifications: [{ kind: 'unchanged', noteId: 'note-1' }],
      latestCommitSha: 'commit-sha',
    })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    expect(syncToGitHubMock).not.toHaveBeenCalled()
    expect(result.current.syncState.kind).toBe('ok')
    if (result.current.syncState.kind === 'ok') {
      expect(result.current.syncState.message).toBe('Up to date')
    }
  })

  test('on conflict, opens merge tabs and returns without pushing', async () => {
    pullFromGitHubMock.mockResolvedValue({
      classifications: [
        {
          kind: 'conflict',
          noteId: 'note-1',
          path: 'Existing.md',
          localContent: 'local',
          remoteSha: 'r1',
          remoteContent: 'remote',
          remoteTags: [],
          remoteBody: 'remote',
        },
      ],
      latestCommitSha: 'commit-sha',
    })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    // Conflicts route through applyNonConflicts (to write the non-conflict
    // siblings) but NEVER through syncToGitHub.
    expect(applyNonConflictsMock).toHaveBeenCalledTimes(1)
    expect(syncToGitHubMock).not.toHaveBeenCalled()

    // A merge-conflict tab should have been added.
    const tabs = useWorkspaceStore.getState().panes[0].tabs
    expect(tabs.some(t => t.kind === 'merge-conflict')).toBe(true)

    expect(result.current.syncState.kind).toBe('err')
    if (result.current.syncState.kind === 'err') {
      expect(result.current.syncState.message).toMatch(/conflict/)
    }
  })

  test('respects the isSyncing guard: second concurrent call is a no-op', async () => {
    // Block the first pull on a deferred promise so we can fire a second
    // call while the first is still "in flight".
    let resolvePull!: (v: { classifications: unknown[]; latestCommitSha: string }) => void
    pullFromGitHubMock.mockImplementation(
      () => new Promise(res => { resolvePull = res as typeof resolvePull }),
    )

    const { result } = renderHook(() => useGitHubSync())

    let firstCall: Promise<void>
    act(() => {
      firstCall = result.current.runPullOnly()
    })

    // Sanity: the guard should be set now.
    expect(useGitHubStore.getState().isSyncing).toBe(true)

    // Fire a second call while the first is still pending — it must bail out
    // immediately without invoking pullFromGitHub a second time.
    await act(async () => {
      await result.current.runPullOnly()
    })
    expect(pullFromGitHubMock).toHaveBeenCalledTimes(1)

    // Now finish the first pull and let the hook clean up.
    await act(async () => {
      resolvePull({ classifications: [], latestCommitSha: 'commit-sha' })
      await firstCall
    })

    expect(syncToGitHubMock).not.toHaveBeenCalled()
    expect(useGitHubStore.getState().isSyncing).toBe(false)
  })

  test('records lastCommitSha after a successful pull-only', async () => {
    // Regression: runPullOnly previously never called recordSync, so a
    // pull-only left lastCommitSha stale (only runSync updated it). The
    // pulled HEAD sha must now become the new baseline.
    pullFromGitHubMock.mockResolvedValue({
      classifications: [
        { kind: 'remoteCreated', path: 'a.md', remoteSha: 'sha1', remoteContent: '', tags: [], body: 'hi' },
      ],
      latestCommitSha: 'pulled-head-sha',
    })
    applyNonConflictsMock.mockReturnValue({ created: 1, updated: 0, deleted: 0, autoMerged: 0 })

    expect(useGitHubStore.getState().lastCommitSha).toBeNull()

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    expect(useGitHubStore.getState().lastCommitSha).toBe('pulled-head-sha')
    expect(useGitHubStore.getState().lastSyncedAt).not.toBeNull()
  })

  test('guard trip surfaces feedback instead of silent no-op', async () => {
    // Reproduces the reported bug: the startup auto-pull (a different
    // useGitHubSync instance) holds the GLOBAL isSyncing flag while this
    // hook's local syncState is still idle. A click that lands must NOT
    // proceed to apply (guard holds) but MUST give the user feedback.
    useGitHubStore.setState({ isSyncing: true })

    const { result } = renderHook(() => useGitHubSync())
    // Local state starts idle — the button (in real UI) is only disabled
    // via the global flag now; verify the guard still bails AND speaks up.
    expect(result.current.syncState.kind).toBe('idle')

    await act(async () => {
      await result.current.runPullOnly()
    })

    // Guard held: never pulled, never applied, never pushed.
    expect(pullFromGitHubMock).not.toHaveBeenCalled()
    expect(applyNonConflictsMock).not.toHaveBeenCalled()
    expect(syncToGitHubMock).not.toHaveBeenCalled()

    // But the user got feedback rather than silence.
    expect(result.current.syncState.kind).toBe('running')
    if (result.current.syncState.kind === 'running') {
      expect(result.current.syncState.message).toMatch(/already in progress/i)
    }
  })

  test('no-op when not connected (no token or no repo)', async () => {
    useGitHubStore.setState({ token: null })

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    expect(pullFromGitHubMock).not.toHaveBeenCalled()
    expect(syncToGitHubMock).not.toHaveBeenCalled()
  })

  test('releases the isSyncing guard even on pull failure', async () => {
    pullFromGitHubMock.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useGitHubSync())
    await act(async () => {
      await result.current.runPullOnly()
    })

    expect(useGitHubStore.getState().isSyncing).toBe(false)
    expect(syncToGitHubMock).not.toHaveBeenCalled()
    expect(result.current.syncState.kind).toBe('err')
    if (result.current.syncState.kind === 'err') {
      expect(result.current.syncState.message).toBe('boom')
    }
  })
})

describe('useGitHubSync — phase-aware running messages', () => {
  test('runPullOnly on a first clone surfaces "Downloading vault…" while the clone downloads', async () => {
    // First clone: no local notes/folders → runPull takes the first-clone
    // branch. no-vercel-clone: that branch now calls pullFromGitHub with
    // isFirstClone=true (parallel blob prefetch), not the zipball proxy.
    useNoteStore.setState({ notes: [], selectedNoteId: null })
    useFolderStore.setState({ folders: [], activeFolderId: null, expandedFolders: {} })

    // Block the pull so we can observe the running message mid-flight.
    let resolvePull!: (v: { classifications: unknown[]; latestCommitSha: string }) => void
    pullFromGitHubMock.mockImplementation(
      () => new Promise(res => { resolvePull = res as typeof resolvePull }),
    )

    const { result } = renderHook(() => useGitHubSync())

    let call!: Promise<void>
    act(() => {
      call = result.current.runPullOnly()
    })

    // The first-clone branch was taken (pullFromGitHub with isFirstClone=true,
    // not the zipball) and the status line announces the slow download phase.
    expect(pullFromZipballMock).not.toHaveBeenCalled()
    expect(pullFromGitHubMock).toHaveBeenCalledTimes(1)
    expect((pullFromGitHubMock.mock.calls[0][0] as { isFirstClone?: boolean }).isFirstClone).toBe(true)
    expect(result.current.syncState.kind).toBe('running')
    if (result.current.syncState.kind === 'running') {
      expect(result.current.syncState.message).toMatch(/Downloading vault/i)
    }

    // Finish the pull so the hook cleans up and the guard releases.
    await act(async () => {
      resolvePull({ classifications: [], latestCommitSha: 'head-sha' })
      await call
    })
    expect(useGitHubStore.getState().isSyncing).toBe(false)
  })
})

describe('useGitHubSync — watchdog timeout', () => {
  // These tests simulate the mobile-stall bug: a fetch that hangs forever.
  // Without the watchdog the global isSyncing flag would stay true for the
  // whole session (the `finally` that clears it never runs). With it, the
  // flag self-heals after SYNC_WATCHDOG_MS and the UI shows a retryable error.
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    // Drain any pending timers (e.g. the success-path idle reset) then hand
    // control back to real timers so later suites aren't affected.
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('runPullOnly: a hung pull clears isSyncing and shows a retryable error', async () => {
    // Pull never resolves — mimics a stalled mobile connection with no fetch
    // timeout.
    pullFromGitHubMock.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useGitHubSync())

    let call!: Promise<void>
    act(() => {
      call = result.current.runPullOnly()
    })

    // Guard is held while the pull is "in flight".
    expect(useGitHubStore.getState().isSyncing).toBe(true)

    // Advance past the watchdog ceiling — the timeout branch fires.
    await act(async () => {
      jest.advanceTimersByTime(45_000)
      await call
    })

    // The non-negotiable invariant: flag cleared, UI shows a retryable error.
    expect(useGitHubStore.getState().isSyncing).toBe(false)
    expect(result.current.syncState.kind).toBe('err')
    if (result.current.syncState.kind === 'err') {
      expect(result.current.syncState.message).toMatch(/timed out/i)
    }
    // A pull-only never pushes, even on timeout.
    expect(syncToGitHubMock).not.toHaveBeenCalled()
  })

  test('runSync: a hung sync clears isSyncing and shows a retryable error', async () => {
    pullFromGitHubMock.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useGitHubSync())

    let call!: Promise<void>
    act(() => {
      call = result.current.runSync()
    })

    expect(useGitHubStore.getState().isSyncing).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(45_000)
      await call
    })

    expect(useGitHubStore.getState().isSyncing).toBe(false)
    expect(result.current.syncState.kind).toBe('err')
    if (result.current.syncState.kind === 'err') {
      expect(result.current.syncState.message).toMatch(/timed out/i)
    }
  })
})
