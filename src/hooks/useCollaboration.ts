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
import { useSettingsStore } from '@/stores/settingsStore'
import { useActiveCollabStore } from '@/stores/activeCollabStore'

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

// Dedicated room the connectivity probe dials. The collab worker requires a
// `/<AUTH_TOKEN>/<room>` path (token = second-to-last segment, room = last);
// NEXT_PUBLIC_YJS_WS_URL is configured as the BARE `<base>/<token>` with NO
// room. Opening a socket straight to that bare URL gives the worker a single
// path segment, which it reads as the ROOM with no token → 403 → the probe
// false-reports "unreachable" even though the real document binding (which
// connects to `<url>/<room>`) authenticates fine. Appending a probe room
// makes the probe hit the same `/<token>/<room>` shape the worker accepts.
const PROBE_ROOM = '__probe__'

// Build the URL the connectivity probe actually dials: the configured base
// URL plus a dedicated probe room, mirroring how WebsocketProvider(url, room)
// connects to `<url>/<room>`. Exported for unit testing.
export function buildProbeUrl(url: string): string {
  return `${url.replace(/\/+$/, '')}/${PROBE_ROOM}`
}

// Whether the collaboration TRANSPORT is configured: NEXT_PUBLIC_YJS_WS_URL is
// a valid ws:// / wss:// URL AND the legacy NEXT_PUBLIC_COLLAB_DISABLED kill
// switch is not set. This is purely about "could we connect at all" — it does
// NOT consult the user's collaborationMode setting. Use it for UI that should
// show whenever collaboration is *available* (e.g. the Share button + the
// per-note Live toggle in EditorFooter). To decide whether to actually OPEN a
// room for a given note, use getCollabUrlForNote() below, which layers the
// mode + per-note active state on top.
//
// Returns null unless NEXT_PUBLIC_YJS_WS_URL is a valid ws:// / wss:// URL —
// which keeps the whole feature dormant on any deploy without that env.
//
// NEXT_PUBLIC_COLLAB_DISABLED is kept as a hard env-level override (e.g. to
// force collab off on a specific deploy regardless of any user's setting), but
// it is no longer the PRIMARY control — the collaborationMode setting (default
// 'off') is, so beta is fast without needing the env. See
// [[project_noteser_note_switch_perf]].
export function getConfiguredUrl(): string | null {
  if (typeof process === 'undefined') return null
  if (process.env.NEXT_PUBLIC_COLLAB_DISABLED === '1') return null
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

// Resolve the URL the editor should actually dial for a SPECIFIC note, applying
// the user's collaborationMode setting on top of the configured transport. This
// is the single source of truth the Phase-B binding (collabExtension) gate uses
// so the editor only connects when it should:
//
//   'off'      → always null (collab never connects; editor seeds locally).
//   'repo'     → the configured URL for every note (old eager behaviour).
//   'per-note' → the configured URL ONLY when this note has been explicitly
//                activated this session (EditorFooter Live toggle / share-link
//                join, tracked in useActiveCollabStore). Otherwise null, so an
//                un-activated note behaves exactly like 'off' — no room, no
//                socket, fast switch.
//
// Reads the stores via getState() so non-React callers (the editor effect) get
// a fresh snapshot without subscribing.
export function getCollabUrlForNote(noteId: string | null): string | null {
  const url = getConfiguredUrl()
  if (!url) return null
  const mode = useSettingsStore.getState().collaborationMode
  if (mode === 'off') return null
  if (mode === 'repo') return url
  // per-note: gate on explicit activation for this note.
  if (!noteId) return null
  return useActiveCollabStore.getState().isActive(noteId) ? url : null
}

export function useCollaboration(): CollabState {
  // The probe only dials when collaboration is in play at all: a transport is
  // configured AND the user's mode isn't 'off'. In 'off' mode the probe stays
  // dormant (url=null) so the status pill hides and no socket opens — which is
  // exactly the fast default. In 'per-note' / 'repo' the probe reports server
  // reachability for the status pill. Subscribing to collaborationMode makes
  // the probe (re)bind live when the user flips the setting.
  const mode = useSettingsStore(s => s.collaborationMode)
  const url = mode === 'off' ? null : getConfiguredUrl()
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
      // Dial the probe room (not the bare configured URL) so the worker sees
      // the `/<token>/<room>` path it requires and accepts the socket.
      ws = new WebSocket(buildProbeUrl(url))
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
    // Mode 'off' (or no transport) → tear down any live probe and report off.
    // Re-binds whenever `url` changes, which now happens when the user flips
    // collaborationMode at runtime (the env itself is still fixed per deploy).
    if (!url) {
      intentRef.current = 'disconnect'
      cleanup()
      setStatus('off')
      return
    }
    intentRef.current = 'connect'
    attemptsRef.current = 0
    setAttempts(0)
    connect()
    return () => {
      intentRef.current = 'disconnect'
      cleanup()
    }
  }, [url, connect, cleanup])

  return { status, attempts, url, reconnect, disconnect }
}
