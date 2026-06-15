/**
 * @jest-environment jsdom
 *
 * useCollaboration hook tests. The hook reads NEXT_PUBLIC_YJS_WS_URL
 * (a build-time env var; jest's process.env stand-in lets us flip it
 * per test) and opens a WebSocket to that URL when set.
 *
 * We mock global.WebSocket so the hook never tries to reach a real
 * server. Each test wires its mock to dispatch open/close as needed.
 */

import { renderHook, act } from '@testing-library/react'
import { useCollaboration, buildProbeUrl, getCollabUrlForNote } from '../hooks/useCollaboration'
import { useSettingsStore } from '../stores/settingsStore'
import { useActiveCollabStore } from '../stores/activeCollabStore'

// Test double for window.WebSocket. Captures whichever instance the
// hook constructs so tests can fire open/close events synchronously.
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static lastConstructorArg = ''
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  url: string
  constructor(url: string) {
    this.url = url
    MockWebSocket.lastConstructorArg = url
    MockWebSocket.instances.push(this)
  }
  close() {
    this.readyState = 3
    // Real browsers fire `onclose` asynchronously after close(). In
    // tests that branch only matters when we're explicitly asserting on
    // disconnect/reconnect behavior — those tests drive it via
    // fireClose(). Auto-firing here would dispatch onclose during the
    // hook's useEffect cleanup at test teardown, which calls setStatus
    // outside any act() boundary and trips a React warning. Tests that
    // care call fireClose() directly inside act().
  }
  fireOpen() { this.readyState = 1; this.onopen?.() }
  fireClose() { this.readyState = 3; this.onclose?.() }
}

const ORIGINAL_WS = global.WebSocket
const ORIGINAL_URL = process.env.NEXT_PUBLIC_YJS_WS_URL

beforeEach(() => {
  MockWebSocket.instances = []
  MockWebSocket.lastConstructorArg = ''
  ;(global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket
  // The probe now also gates on the collaborationMode setting. Default is
  // 'off', under which the hook never dials — so the connection-behaviour
  // tests below set 'repo' (connect whenever a transport is configured). The
  // dedicated "mode off" test overrides this back to 'off'.
  useSettingsStore.setState({ collaborationMode: 'repo' })
})

afterEach(() => {
  ;(global as unknown as { WebSocket: typeof ORIGINAL_WS }).WebSocket = ORIGINAL_WS
  if (ORIGINAL_URL == null) delete process.env.NEXT_PUBLIC_YJS_WS_URL
  else process.env.NEXT_PUBLIC_YJS_WS_URL = ORIGINAL_URL
  useSettingsStore.setState({ collaborationMode: 'off' })
})

describe('buildProbeUrl', () => {
  test('appends a /<room> segment so the worker sees /<token>/<room>', () => {
    // Configured URL is the bare base + token, with NO room. The worker reads
    // the LAST segment as the room and the one before it as the token, so the
    // probe must dial `<base>/<token>/<room>` — never the bare URL (which the
    // worker would read as a single-segment room with no token → 403).
    expect(buildProbeUrl('wss://collab.noteser.app/deadbeefToken')).toBe(
      'wss://collab.noteser.app/deadbeefToken/__probe__',
    )
  })
  test('does not double the slash when the URL has a trailing slash', () => {
    expect(buildProbeUrl('wss://collab.noteser.app/tok/')).toBe(
      'wss://collab.noteser.app/tok/__probe__',
    )
  })
})

describe('useCollaboration', () => {
  test('without NEXT_PUBLIC_YJS_WS_URL: status is "off" and no WS is opened', () => {
    delete process.env.NEXT_PUBLIC_YJS_WS_URL
    const { result } = renderHook(() => useCollaboration())
    expect(result.current.status).toBe('off')
    expect(result.current.url).toBeNull()
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  test('collaborationMode "off" keeps the probe dormant even with a configured URL', () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com/room'
    useSettingsStore.setState({ collaborationMode: 'off' })
    const { result } = renderHook(() => useCollaboration())
    expect(result.current.status).toBe('off')
    expect(result.current.url).toBeNull()
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  test('rejects non-ws/wss URLs', () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'https://not-a-ws.example.com'
    const { result } = renderHook(() => useCollaboration())
    expect(result.current.status).toBe('off')
    expect(result.current.url).toBeNull()
  })

  test('with wss URL: opens WS, status flips connecting → connected on open', () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com/room'
    const { result } = renderHook(() => useCollaboration())
    expect(result.current.status).toBe('connecting')
    expect(result.current.url).toBe('wss://collab.example.com/room')
    expect(MockWebSocket.instances).toHaveLength(1)

    act(() => { MockWebSocket.instances[0].fireOpen() })
    expect(result.current.status).toBe('connected')
    expect(result.current.attempts).toBe(0)
  })

  test('dials the probe room (/__probe__), not the bare configured URL', () => {
    // Regression for the false "Live: unreachable" pill: the configured URL is
    // the bare `<base>/<token>` with no room. The probe must append a room so
    // the worker's `/<token>/<room>` auth check passes — the bare URL is read
    // as a single-segment room with no token and rejected (403).
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com/sometoken'
    const { result } = renderHook(() => useCollaboration())
    expect(MockWebSocket.lastConstructorArg).toBe(
      'wss://collab.example.com/sometoken/__probe__',
    )
    // The exposed url stays the bare configured value (used by the pill tooltip).
    expect(result.current.url).toBe('wss://collab.example.com/sometoken')
  })

  test('close before open: status flips to disconnected and attempt counter ticks', () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com/room'
    const { result } = renderHook(() => useCollaboration())
    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => { MockWebSocket.instances[0].fireClose() })
    expect(result.current.status).toBe('disconnected')
    expect(result.current.attempts).toBe(1)
  })

  test('disconnect() halts the reconnect loop', async () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com/room'
    const { result } = renderHook(() => useCollaboration())
    // MockWebSocket.close() delivers onclose on a microtask (mirroring a
    // real socket's async close). Flush that microtask INSIDE act() so the
    // hook's setStatus('disconnected') (useCollaboration.ts onclose
    // handler) is act-covered instead of warning (issue #130).
    await act(async () => {
      result.current.disconnect()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('disconnected')
    // No further attempt should be scheduled.
    const before = MockWebSocket.instances.length
    // Advance microtasks — nothing should happen.
    return new Promise<void>((r) => setTimeout(() => {
      expect(MockWebSocket.instances.length).toBe(before)
      r()
    }, 20))
  })
})

describe('getCollabUrlForNote — mode + per-note gating', () => {
  const URL = 'wss://collab.example.com/room'
  beforeEach(() => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = URL
    useActiveCollabStore.setState({ activeNoteIds: {} })
  })

  test('off → always null, regardless of activation', () => {
    useSettingsStore.setState({ collaborationMode: 'off' })
    useActiveCollabStore.getState().activate('n1')
    expect(getCollabUrlForNote('n1')).toBeNull()
  })

  test('repo → the configured URL for every note', () => {
    useSettingsStore.setState({ collaborationMode: 'repo' })
    expect(getCollabUrlForNote('n1')).toBe(URL)
    expect(getCollabUrlForNote('n2')).toBe(URL)
  })

  test('per-note → URL only for an activated note, null otherwise', () => {
    useSettingsStore.setState({ collaborationMode: 'per-note' })
    expect(getCollabUrlForNote('n1')).toBeNull()
    useActiveCollabStore.getState().activate('n1')
    expect(getCollabUrlForNote('n1')).toBe(URL)
    expect(getCollabUrlForNote('n2')).toBeNull()
    // Deactivating returns it to solo.
    useActiveCollabStore.getState().deactivate('n1')
    expect(getCollabUrlForNote('n1')).toBeNull()
  })

  test('no transport configured → null even in repo mode', () => {
    delete process.env.NEXT_PUBLIC_YJS_WS_URL
    useSettingsStore.setState({ collaborationMode: 'repo' })
    expect(getCollabUrlForNote('n1')).toBeNull()
  })
})
