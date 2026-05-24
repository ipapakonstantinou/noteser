/**
 * useAutoSync.test.tsx
 *
 * Verifies the two trigger paths:
 *   1. one-shot on startup when autoSyncOnStart && isConnected
 *   2. periodic interval when autoSyncIntervalMinutes > 0
 *
 * Mocks useGitHubSync so we don't drive real network calls; spies on
 * the returned runSync to count invocations.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

// useGitHubSync is mocked so the hook under test sees a controllable
// runSync + a controllable isConnected. syncState is fixed at idle.
const runSyncMock = jest.fn().mockResolvedValue(undefined)
let mockIsConnected = true
jest.mock('../hooks/useGitHubSync', () => ({
  useGitHubSync: () => ({
    runSync: runSyncMock,
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

describe('useAutoSync — one-shot on startup', () => {
  test('runs once when autoSyncOnStart is on and a repo is connected', () => {
    useSettingsStore.setState({ autoSyncOnStart: true })
    render(<Harness />)
    expect(runSyncMock).toHaveBeenCalledTimes(1)
  })

  test('does NOT run when autoSyncOnStart is off', () => {
    useSettingsStore.setState({ autoSyncOnStart: false })
    render(<Harness />)
    expect(runSyncMock).not.toHaveBeenCalled()
  })

  test('does NOT run when there is no connected repo', () => {
    mockIsConnected = false
    useSettingsStore.setState({ autoSyncOnStart: true })
    render(<Harness />)
    expect(runSyncMock).not.toHaveBeenCalled()
  })
})

describe('useAutoSync — periodic interval', () => {
  test('fires runSync every N minutes', () => {
    jest.useFakeTimers()
    useSettingsStore.setState({ autoSyncIntervalMinutes: 5 })
    render(<Harness />)
    expect(runSyncMock).not.toHaveBeenCalled() // startup is off here

    act(() => { jest.advanceTimersByTime(5 * 60 * 1000) })
    expect(runSyncMock).toHaveBeenCalledTimes(1)

    act(() => { jest.advanceTimersByTime(5 * 60 * 1000) })
    expect(runSyncMock).toHaveBeenCalledTimes(2)
  })

  test('does not fire when interval is 0 (off)', () => {
    jest.useFakeTimers()
    useSettingsStore.setState({ autoSyncIntervalMinutes: 0 })
    render(<Harness />)
    act(() => { jest.advanceTimersByTime(60 * 60 * 1000) })
    expect(runSyncMock).not.toHaveBeenCalled()
  })

  test('rebuilds the interval when minutes change, without leaking timers', () => {
    jest.useFakeTimers()
    useSettingsStore.setState({ autoSyncIntervalMinutes: 5 })
    const { unmount } = render(<Harness />)

    act(() => { jest.advanceTimersByTime(5 * 60 * 1000) })
    expect(runSyncMock).toHaveBeenCalledTimes(1)

    act(() => {
      useSettingsStore.setState({ autoSyncIntervalMinutes: 15 })
    })

    // Old 5-minute timer should be gone; advance 5 more minutes — still 1 call.
    act(() => { jest.advanceTimersByTime(5 * 60 * 1000) })
    expect(runSyncMock).toHaveBeenCalledTimes(1)

    // 15-minute timer fires after 15 minutes total from the rebuild.
    act(() => { jest.advanceTimersByTime(10 * 60 * 1000) })
    expect(runSyncMock).toHaveBeenCalledTimes(2)

    unmount()
  })
})
