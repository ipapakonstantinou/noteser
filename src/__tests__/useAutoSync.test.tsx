/**
 * useAutoSync.test.tsx
 *
 * Verifies the two trigger paths:
 *   1. one-shot on startup when autoSyncOnStart && isConnected
 *   2. periodic interval when autoSyncIntervalMinutes > 0
 *
 * Auto-sync is PULL-ONLY: both paths call runPullOnly, never runSync. Pushing
 * happens only on an explicit user action (Commit & Sync). We mock
 * useGitHubSync and assert on runPullOnly; runSync must NEVER be called by the
 * automatic paths.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// useGitHubSync is mocked so the hook under test sees a controllable
// runPullOnly + a controllable isConnected. syncState is fixed at idle.
// runSync is provided too, only to assert the auto paths NEVER call it.
const runPullOnlyMock = jest.fn().mockResolvedValue(undefined)
const runSyncMock = jest.fn().mockResolvedValue(undefined)
let mockIsConnected = true
jest.mock('../hooks/useGitHubSync', () => ({
  useGitHubSync: () => ({
    runSync: runSyncMock,
    runPullOnly: runPullOnlyMock,
    isConnected: mockIsConnected,
    syncState: { kind: 'idle' },
  }),
}))

// useStoresHydrated is mocked to return true so the startup/interval effects
// fire immediately (the real hook waits for async IndexedDB rehydration).
jest.mock('../hooks/useStoresHydrated', () => ({
  useStoresHydrated: () => true,
}))

import React from 'react'
import { render, act } from '@testing-library/react'
import { useAutoSync } from '../hooks/useAutoSync'
import { useSettingsStore } from '../stores/settingsStore'

function Harness() {
  useAutoSync()
  return null
}

beforeEach(() => {
  runPullOnlyMock.mockClear()
  runSyncMock.mockClear()
  mockIsConnected = true
  // Reset settings to known values per test.
  useSettingsStore.setState({
    autoSyncOnStart: false,
    autoSyncIntervalMinutes: 0,
  })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('useAutoSync — one-shot on startup (pull-only)', () => {
  test('pulls once when autoSyncOnStart is on and a repo is connected; never pushes', () => {
    useSettingsStore.setState({ autoSyncOnStart: true })
    render(<Harness />)
    expect(runPullOnlyMock).toHaveBeenCalledTimes(1)
    expect(runSyncMock).not.toHaveBeenCalled()
  })

  test('does NOT run when autoSyncOnStart is off', () => {
    useSettingsStore.setState({ autoSyncOnStart: false })
    render(<Harness />)
    expect(runPullOnlyMock).not.toHaveBeenCalled()
    expect(runSyncMock).not.toHaveBeenCalled()
  })

  test('does NOT run when there is no connected repo', () => {
    mockIsConnected = false
    useSettingsStore.setState({ autoSyncOnStart: true })
    render(<Harness />)
    expect(runPullOnlyMock).not.toHaveBeenCalled()
    expect(runSyncMock).not.toHaveBeenCalled()
  })
})

describe('useAutoSync — periodic interval (pull-only)', () => {
  test('fires runPullOnly (never runSync) every N minutes', () => {
    jest.useFakeTimers()
    useSettingsStore.setState({ autoSyncIntervalMinutes: 5 })
    render(<Harness />)
    expect(runPullOnlyMock).not.toHaveBeenCalled() // startup is off here

    act(() => { jest.advanceTimersByTime(5 * 60 * 1000) })
    expect(runPullOnlyMock).toHaveBeenCalledTimes(1)

    act(() => { jest.advanceTimersByTime(5 * 60 * 1000) })
    expect(runPullOnlyMock).toHaveBeenCalledTimes(2)

    expect(runSyncMock).not.toHaveBeenCalled()
  })

  test('does not fire when interval is 0 (off)', () => {
    jest.useFakeTimers()
    useSettingsStore.setState({ autoSyncIntervalMinutes: 0 })
    render(<Harness />)
    act(() => { jest.advanceTimersByTime(60 * 60 * 1000) })
    expect(runPullOnlyMock).not.toHaveBeenCalled()
  })

  test('rebuilds the interval when minutes change, without leaking timers', () => {
    jest.useFakeTimers()
    useSettingsStore.setState({ autoSyncIntervalMinutes: 5 })
    const { unmount } = render(<Harness />)

    act(() => { jest.advanceTimersByTime(5 * 60 * 1000) })
    expect(runPullOnlyMock).toHaveBeenCalledTimes(1)

    act(() => {
      useSettingsStore.setState({ autoSyncIntervalMinutes: 15 })
    })

    // Old 5-minute timer should be gone; advance 5 more minutes — still 1 call.
    act(() => { jest.advanceTimersByTime(5 * 60 * 1000) })
    expect(runPullOnlyMock).toHaveBeenCalledTimes(1)

    // 15-minute timer fires after 15 minutes total from the rebuild.
    act(() => { jest.advanceTimersByTime(10 * 60 * 1000) })
    expect(runPullOnlyMock).toHaveBeenCalledTimes(2)

    unmount()
  })
})
