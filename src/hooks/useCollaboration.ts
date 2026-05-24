'use client'

// Phase A of live collaboration: a connectivity probe to the configured
// Yjs websocket endpoint. NO document sync yet — opening a WS just
// proves the user has a reachable server. Future PRs layer Y.Doc +
// awareness + remote-cursor decorations on top of this.
//
// The hook is opt-in: it only attempts a connection when
// NEXT_PUBLIC_YJS_WS_URL is set. Without it, status is permanently
// 'off' and no WebSocket is ever opened.
//
// Reconnect strategy: 5 attempts, 1s → 2s → 4s → 8s → 16s. After the
// last attempt fails the status sticks at 'error' until the user
// triggers a manual reconnect (or reloads).

import { useEffect, useState, useRef, useCallback } from 'react'

export type CollabStatus = 'off' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface CollabState {
  status: CollabStatus
  // Diagnostic: how many reconnect attempts we've burned through.
  // Resets to 0 once a connection succeeds. Useful for the UI to show
  // "Retrying… (2 of 5)" without exposing the full retry policy.
  attempts: number
  // The configured URL, exposed so the UI can show it in the status
  // tooltip and skip rendering when null.
  url: string | null
  // User-triggered reconnect. No-op when status is 'connecting' or
  // 'off'.
  reconnect: () => void
  // User-triggered disconnect — closes the socket and stops the
  // reconnect loop until reconnect() is called.
  disconnect: () => void
}

const MAX_ATTEMPTS = 5

// Exported so the Phase-B collaboration binding (collabExtension) shares the
// exact same gate as the Phase-A connectivity probe: a single source of
// truth for "is collab enabled, and at what URL". Returns null unless
// NEXT_PUBLIC_YJS_WS_URL is a valid ws:// / wss:// URL — which is what keeps
// the whole feature dormant by default.
export function getConfiguredUrl(): string | null {
  if (typeof process === 'undefined') return null
  const raw = process.env.NEXT_PUBLIC_YJS_WS_URL
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Reject anything that isn't a ws:// or wss:// URL — keeps the CSP
  // tight scope (see audit finding 5) honest at runtime too.
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null
    return trimmed
  } catch {
    return null
  }
}

export function useCollaboration(): CollabState {
  const url = getConfiguredUrl()
  const [status, setStatus] = useState<CollabStatus>(url ? 'connecting' : 'off')
  const [attempts, setAttempts] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intentRef = useRef<'connect' | 'disconnect'>('connect')
  const attemptsRef = useRef(0)

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (wsRef.current) {
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (!url) {
      setStatus('off')
      return
    }
    if (intentRef.current === 'disconnect') return
    cleanup()
    setStatus('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      setStatus('error')
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      attemptsRef.current = 0
      setAttempts(0)
      setStatus('connected')
    }
    ws.onclose = () => {
      if (intentRef.current === 'disconnect') {
        setStatus('disconnected')
        return
      }
      // Schedule a reconnect with exponential backoff.
      const a = attemptsRef.current + 1
      attemptsRef.current = a
      setAttempts(a)
      if (a > MAX_ATTEMPTS) {
        setStatus('error')
        return
      }
      const delay = Math.min(1000 * Math.pow(2, a - 1), 16_000)
      setStatus('disconnected')
      retryTimerRef.current = setTimeout(() => {
        if (intentRef.current === 'connect') connect()
      }, delay)
    }
    ws.onerror = () => {
      // onerror fires before onclose; let onclose handle reconnect so
      // the backoff logic lives in one place.
    }
  }, [url, cleanup])

  const reconnect = useCallback(() => {
    if (!url) return
    intentRef.current = 'connect'
    attemptsRef.current = 0
    setAttempts(0)
    connect()
  }, [url, connect])

  const disconnect = useCallback(() => {
    intentRef.current = 'disconnect'
    cleanup()
    setStatus('disconnected')
  }, [cleanup])

  useEffect(() => {
    if (!url) return
    intentRef.current = 'connect'
    connect()
    return () => {
      intentRef.current = 'disconnect'
      cleanup()
    }
    // url is read once at mount via the module-level helper — the env
    // var doesn't change at runtime in a Next.js client component, so
    // re-binding the effect on it is unnecessary noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { status, attempts, url, reconnect, disconnect }
}
