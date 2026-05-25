/**
 * @jest-environment jsdom
 *
 * Auto-sync is PULL-ONLY. On boot (and on the interval) the hook calls
 * runPullOnly (pull, apply, STOP), never runSync (which pushes). Pushing
 * happens only on an explicit user action (Commit & Sync, revert, discard,
 * connecting a repo). Firm rule: if the user does not click Commit & Sync,
 * nothing is pushed. The old `pullOnlyOnStartup` setting is therefore moot for
 * the push decision and no longer gates it.
 */

import { renderHook } from '@testing-library/react'

// Mock the hook chain BEFORE importing useAutoSync — the hook reads
// these via captured references, so the mocks must be in place at
// import time.
const runSync = jest.fn(async () => undefined)
const runPullOnly = jest.fn(async () => undefined)

jest.mock('../hooks/useGitHubSync', () => ({
  useGitHubSync: () => ({
    runSync,
    runPullOnly,
    isConnected: true,
    syncState: { kind: 'idle' },
  }),
}))
jest.mock('../hooks/useStoresHydrated', () => ({
  useStoresHydrated: () => true,
}))

// Mutable settings the hook reads.
const mockSettings: { autoSyncOnStart: boolean; pullOnlyOnStartup: boolean; autoSyncIntervalMinutes: number } = {
  autoSyncOnStart: true,
  pullOnlyOnStartup: false,
  autoSyncIntervalMinutes: 0,
}
jest.mock('../stores', () => ({
  useSettingsStore: (selector: (s: typeof mockSettings) => unknown) => selector(mockSettings),
  // progressive-clone: the reload-resume effect reads useNoteStore.getState()
  // to check for outstanding shells. Stub it to an empty vault so the effect
  // is a no-op in these settings-focused tests.
  useNoteStore: { getState: () => ({ notes: [] }) },
}))

// progressive-clone: stub the background fill so the resume effect doesn't try
// to reach the network from these unit tests.
const fillShellsInBackground = jest.fn(async () => undefined)
jest.mock('../utils/backgroundFill', () => ({
  fillShellsInBackground: () => fillShellsInBackground(),
}))

import { useAutoSync } from '../hooks/useAutoSync'

beforeEach(() => {
  runSync.mockClear()
  runPullOnly.mockClear()
  mockSettings.autoSyncOnStart = true
  mockSettings.pullOnlyOnStartup = false
  mockSettings.autoSyncIntervalMinutes = 0
})

describe('useAutoSync — startup is pull-only (never pushes)', () => {
  test('autoSyncOnStart=true: runs runPullOnly on mount, NEVER runSync', () => {
    renderHook(() => useAutoSync())
    expect(runPullOnly).toHaveBeenCalledTimes(1)
    expect(runSync).not.toHaveBeenCalled()
  })

  test('still pull-only regardless of the legacy pullOnlyOnStartup setting', () => {
    mockSettings.pullOnlyOnStartup = true
    renderHook(() => useAutoSync())
    expect(runPullOnly).toHaveBeenCalledTimes(1)
    expect(runSync).not.toHaveBeenCalled()
  })

  test('autoSyncOnStart=false: neither runs', () => {
    mockSettings.autoSyncOnStart = false
    renderHook(() => useAutoSync())
    expect(runSync).not.toHaveBeenCalled()
    expect(runPullOnly).not.toHaveBeenCalled()
  })
})
