'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'
import { useCollaborationStore } from '@/stores'
import type { Presence } from '@/types'

interface UseCollaborationOptions {
  noteId: string
  serverUrl?: string
  onContentChange?: (content: string) => void
  onPresenceChange?: (users: Presence[]) => void
}

interface UseCollaborationReturn {
  content: string
  setContent: (content: string) => void
  isConnected: boolean
  isConnecting: boolean
  users: Presence[]
  error: string | null
  updateCursor: (line: number, column: number) => void
  updateSelection: (start: number, end: number) => void
}

// Real-time collaboration is opt-in via NEXT_PUBLIC_YJS_WS_URL. If unset,
// we skip the WebSocket provider entirely and rely on IndexedDB persistence
// only. This avoids leaking notes onto the public Yjs demo server (which
// is what we used to default to). To enable collaboration, run your own
// y-websocket server and set the env var to its URL.
export const useCollaboration = ({
  noteId,
  serverUrl = process.env.NEXT_PUBLIC_YJS_WS_URL,
  onContentChange,
  onPresenceChange
}: UseCollaborationOptions): UseCollaborationReturn => {
  const [content, setContentState] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ydocRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const persistenceRef = useRef<IndexeddbPersistence | null>(null)
  const ytextRef = useRef<Y.Text | null>(null)

  const {
    currentUser,
    setCurrentUser,
    isConnecting,
    setConnectionStatus,
    updatePresence,
    removePresence,
    getRoomUsers
  } = useCollaborationStore()

  // Initialize user if not exists
  useEffect(() => {
    if (!currentUser) {
      const colors = ['#ef4444', '#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899']
      const adjectives = ['Happy', 'Clever', 'Swift', 'Bright', 'Calm', 'Bold']
      const animals = ['Panda', 'Fox', 'Owl', 'Bear', 'Wolf', 'Eagle']

      setCurrentUser({
        id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]}`,
        color: colors[Math.floor(Math.random() * colors.length)]
      })
    }
  }, [currentUser, setCurrentUser])

  // Set up Yjs document and providers
  useEffect(() => {
    if (!noteId || !currentUser) return

    setConnectionStatus(true)
    setError(null)

    // Create Yjs document
    const ydoc = new Y.Doc()
    ydocRef.current = ydoc

    // Create shared text type
    const ytext = ydoc.getText('content')
    ytextRef.current = ytext

    // Set up IndexedDB persistence for offline support
    const persistence = new IndexeddbPersistence(`noteser-${noteId}`, ydoc)
    persistenceRef.current = persistence

    persistence.on('synced', () => {
      console.log('Content loaded from IndexedDB')
    })

    // Real-time sync only if the user has configured a server.
    let provider: WebsocketProvider | null = null
    let handleAwarenessChange: (() => void) | null = null
    if (serverUrl) {
      const roomName = `noteser-${noteId}`
      provider = new WebsocketProvider(serverUrl, roomName, ydoc, { connect: true })
      providerRef.current = provider

      provider.on('status', (event: { status: string }) => {
        const connected = event.status === 'connected'
        setIsConnected(connected)
        setConnectionStatus(false, connected ? null : 'Disconnected from server')
      })

      provider.on('connection-error', (event: Event) => {
        console.error('Connection error:', event)
        setError('Failed to connect to collaboration server')
        setConnectionStatus(false, 'Connection error')
      })

      const awareness = provider.awareness
      awareness.setLocalStateField('user', {
        id: currentUser.id,
        name: currentUser.name,
        color: currentUser.color,
      })

      handleAwarenessChange = () => {
        const states = awareness.getStates()
        const users: Presence[] = []
        states.forEach((state, clientId) => {
          if (state.user && clientId !== awareness.clientID) {
            users.push({
              oderId: state.user.id,
              name: state.user.name,
              color: state.user.color,
              cursor: state.cursor,
              selection: state.selection,
              lastSeen: Date.now(),
            })
          }
        })
        users.forEach(user => updatePresence(noteId, user))
        onPresenceChange?.(users)
      }
      awareness.on('change', handleAwarenessChange)
    } else {
      // Local-only mode: mark as "connected" since IndexedDB is what we have.
      setIsConnected(true)
      setConnectionStatus(false)
    }

    // Handle text changes
    const handleTextChange = () => {
      const newContent = ytext.toString()
      setContentState(newContent)
      onContentChange?.(newContent)
    }

    ytext.observe(handleTextChange)

    // Initialize content
    handleTextChange()

    // Cleanup
    return () => {
      if (provider && handleAwarenessChange) {
        provider.awareness.off('change', handleAwarenessChange)
      }
      ytext.unobserve(handleTextChange)
      provider?.disconnect()
      persistence.destroy()
      ydoc.destroy()
    }
  }, [
    noteId,
    serverUrl,
    currentUser,
    setConnectionStatus,
    updatePresence,
    onContentChange,
    onPresenceChange
  ])

  // Set content
  const setContent = useCallback((newContent: string) => {
    if (!ytextRef.current || !ydocRef.current) return

    ydocRef.current.transact(() => {
      ytextRef.current!.delete(0, ytextRef.current!.length)
      ytextRef.current!.insert(0, newContent)
    })
  }, [])

  // Update cursor position
  const updateCursor = useCallback((line: number, column: number) => {
    if (!providerRef.current) return

    providerRef.current.awareness.setLocalStateField('cursor', {
      line,
      column
    })
  }, [])

  // Update selection
  const updateSelection = useCallback((start: number, end: number) => {
    if (!providerRef.current) return

    providerRef.current.awareness.setLocalStateField('selection', {
      start,
      end
    })
  }, [])

  return {
    content,
    setContent,
    isConnected,
    isConnecting,
    users: getRoomUsers(noteId),
    error,
    updateCursor,
    updateSelection
  }
}

// Simplified hook for local-only collaboration (no server)
export const useLocalCollaboration = (noteId: string) => {
  const [content, setContentState] = useState('')
  const ydocRef = useRef<Y.Doc | null>(null)
  const persistenceRef = useRef<IndexeddbPersistence | null>(null)
  const ytextRef = useRef<Y.Text | null>(null)

  useEffect(() => {
    if (!noteId) return

    const ydoc = new Y.Doc()
    ydocRef.current = ydoc

    const ytext = ydoc.getText('content')
    ytextRef.current = ytext

    // Only use IndexedDB for persistence
    const persistence = new IndexeddbPersistence(`noteser-local-${noteId}`, ydoc)
    persistenceRef.current = persistence

    const handleTextChange = () => {
      setContentState(ytext.toString())
    }

    ytext.observe(handleTextChange)
    handleTextChange()

    return () => {
      ytext.unobserve(handleTextChange)
      persistence.destroy()
      ydoc.destroy()
    }
  }, [noteId])

  const setContent = useCallback((newContent: string) => {
    if (!ytextRef.current || !ydocRef.current) return

    ydocRef.current.transact(() => {
      ytextRef.current!.delete(0, ytextRef.current!.length)
      ytextRef.current!.insert(0, newContent)
    })
  }, [])

  return { content, setContent }
}
