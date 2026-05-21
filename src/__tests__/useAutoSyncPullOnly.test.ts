/**
 * @jest-environment jsdom
 *
 * pullOnlyOnStartup behaviour. The hook calls runPullOnly (pull, apply,
 * STOP) instead of runSync (pull, apply, push) when this device-level
 * setting is on. Useful when a device has frequent work-in-flight that
 * the user doesn't want auto-pushed on every page load.
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
jest.mock('../hooks/useHydration', () => ({
  useHydration: () => true,
}))

// Mutable settings the hook reads.
const mockSettings: { autoSyncOnStart: boolean; pullOnlyOnStartup: boolean; autoSyncIntervalMinutes: number } = {
  autoSyncOnStart: true,
  pullOnlyOnStartup: false,
  autoSyncIntervalMinutes: 0,
}
jest.mock('../stores', () => ({
  useSettingsStore: (selector: (s: typeof mockSettings) => unknown) => selector(mockSettings),
}))

import { useAutoSync } from '../hooks/useAutoSync'

beforeEach(() => {
  runSync.mockClear()
  runPullOnly.mockClear()
  mockSettings.autoSyncOnStart = true
  mockSettings.pullOnlyOnStartup = false
  mockSettings.autoSyncIntervalMinutes = 0
})

describe('useAutoSync — pullOnlyOnStartup', () => {
  test('default: runs runSync (full pull + push) on mount', () => {
    renderHook(() => useAutoSync())
    expect(runSync).toHaveBeenCalledTimes(1)
    expect(runPullOnly).not.toHaveBeenCalled()
  })

  test('pullOnlyOnStartup=true: runs runPullOnly instead', () => {
    mockSettings.pullOnlyOnStartup = true
    renderHook(() => useAutoSync())
    expect(runPullOnly).toHaveBeenCalledTimes(1)
    expect(runSync).not.toHaveBeenCalled()
  })

  test('autoSyncOnStart=false: neither runs', () => {
    mockSettings.autoSyncOnStart = false
    mockSettings.pullOnlyOnStartup = true
    renderHook(() => useAutoSync())
    expect(runSync).not.toHaveBeenCalled()
    expect(runPullOnly).not.toHaveBeenCalled()
  })
})
