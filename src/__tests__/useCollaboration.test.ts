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
import { useCollaboration } from '../hooks/useCollaboration'

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
})

afterEach(() => {
  ;(global as unknown as { WebSocket: typeof ORIGINAL_WS }).WebSocket = ORIGINAL_WS
  if (ORIGINAL_URL == null) delete process.env.NEXT_PUBLIC_YJS_WS_URL
  else process.env.NEXT_PUBLIC_YJS_WS_URL = ORIGINAL_URL
})

describe('useCollaboration', () => {
  test('without NEXT_PUBLIC_YJS_WS_URL: status is "off" and no WS is opened', () => {
    delete process.env.NEXT_PUBLIC_YJS_WS_URL
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

  test('close before open: status flips to disconnected and attempt counter ticks', () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com/room'
    const { result } = renderHook(() => useCollaboration())
    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => { MockWebSocket.instances[0].fireClose() })
    expect(result.current.status).toBe('disconnected')
    expect(result.current.attempts).toBe(1)
  })

  test('disconnect() halts the reconnect loop', () => {
    process.env.NEXT_PUBLIC_YJS_WS_URL = 'wss://collab.example.com/room'
    const { result } = renderHook(() => useCollaboration())
    act(() => { result.current.disconnect() })
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
