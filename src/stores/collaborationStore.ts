import { create } from 'zustand'
import type { Presence, CollaborationRoom, User } from '@/types'

interface CollaborationState {
  // Current user
  currentUser: User | null

  // Room state
  rooms: Map<string, CollaborationRoom>
  activeRoomId: string | null

  // Connection status
  isConnecting: boolean
  connectionError: string | null

  // Actions
  setCurrentUser: (user: User) => void
  joinRoom: (noteId: string) => void
  leaveRoom: (noteId: string) => void
  setActiveRoom: (noteId: string | null) => void
  updatePresence: (noteId: string, presence: Presence) => void
  removePresence: (noteId: string, oderId: string) => void
  setConnectionStatus: (isConnecting: boolean, error?: string | null) => void

  // Getters
  getRoomUsers: (noteId: string) => Presence[]
  isUserInRoom: (noteId: string, oderId: string) => boolean
}

// Generate a random color for user presence
const generateUserColor = (): string => {
  const colors = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

// Generate a random anonymous name
const generateAnonName = (): string => {
  const adjectives = ['Happy', 'Clever', 'Swift', 'Bright', 'Calm', 'Bold', 'Kind', 'Wise']
  const animals = ['Panda', 'Fox', 'Owl', 'Bear', 'Wolf', 'Eagle', 'Dolphin', 'Tiger']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const animal = animals[Math.floor(Math.random() * animals.length)]
  return `${adj} ${animal}`
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  currentUser: null,
  rooms: new Map(),
  activeRoomId: null,
  isConnecting: false,
  connectionError: null,

  setCurrentUser: (user) => {
    set({ currentUser: user })
  },

  joinRoom: (noteId) => {
    const { rooms, currentUser } = get()

    if (!currentUser) {
      // Create anonymous user if none exists
      const anonUser: User = {
        id: `anon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: generateAnonName(),
        color: generateUserColor()
      }
      set({ currentUser: anonUser })
    }

    const existingRoom = rooms.get(noteId)
    if (existingRoom) {
      // Already in room
      set({ activeRoomId: noteId })
      return
    }

    // Create new room
    const newRoom: CollaborationRoom = {
      noteId,
      users: [],
      isConnected: false
    }

    const newRooms = new Map(rooms)
    newRooms.set(noteId, newRoom)

    set({
      rooms: newRooms,
      activeRoomId: noteId,
      isConnecting: true
    })
  },

  leaveRoom: (noteId) => {
    const { rooms, activeRoomId } = get()
    const newRooms = new Map(rooms)
    newRooms.delete(noteId)

    set({
      rooms: newRooms,
      activeRoomId: activeRoomId === noteId ? null : activeRoomId
    })
  },

  setActiveRoom: (noteId) => {
    set({ activeRoomId: noteId })
  },

  updatePresence: (noteId, presence) => {
    const { rooms } = get()
    const room = rooms.get(noteId)
    if (!room) return

    const updatedUsers = room.users.filter(u => u.oderId !== presence.oderId)
    updatedUsers.push(presence)

    const newRooms = new Map(rooms)
    newRooms.set(noteId, {
      ...room,
      users: updatedUsers,
      isConnected: true
    })

    set({ rooms: newRooms, isConnecting: false })
  },

  removePresence: (noteId, oderId) => {
    const { rooms } = get()
    const room = rooms.get(noteId)
    if (!room) return

    const newRooms = new Map(rooms)
    newRooms.set(noteId, {
      ...room,
      users: room.users.filter(u => u.oderId !== oderId)
    })

    set({ rooms: newRooms })
  },

  setConnectionStatus: (isConnecting, error = null) => {
    set({ isConnecting, connectionError: error })
  },

  // Getters
  getRoomUsers: (noteId) => {
    const room = get().rooms.get(noteId)
    return room?.users || []
  },

  isUserInRoom: (noteId, oderId) => {
    const room = get().rooms.get(noteId)
    return room?.users.some(u => u.oderId === oderId) || false
  }
}))
