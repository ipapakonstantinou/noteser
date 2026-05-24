/**
 * @jest-environment jsdom
 *
 * useStoresHydrated.test.tsx
 *
 * The hook returns true only once BOTH the note and folder stores have
 * finished their async IndexedDB rehydration. It is the gate that stops the
 * startup auto-sync from firing against an empty (not-yet-hydrated) store and
 * re-importing the whole vault (the mass-duplicate bug).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

import { renderHook, act } from '@testing-library/react'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { useNoteStore } from '../stores/noteStore'
import { useFolderStore } from '../stores/folderStore'

afterEach(() => {
  jest.restoreAllMocks()
})

describe('useStoresHydrated', () => {
  test('stays false until BOTH stores have hydrated', () => {
    // Neither store hydrated yet, and onFinishHydration never fires during
    // the test — the hook must report false.
    jest.spyOn(useNoteStore.persist, 'hasHydrated').mockReturnValue(false)
    jest.spyOn(useFolderStore.persist, 'hasHydrated').mockReturnValue(false)
    jest.spyOn(useNoteStore.persist, 'onFinishHydration').mockReturnValue(() => {})
    jest.spyOn(useFolderStore.persist, 'onFinishHydration').mockReturnValue(() => {})

    const { result } = renderHook(() => useStoresHydrated())
    expect(result.current).toBe(false)
  })

  test('returns true immediately when both stores are already hydrated on mount', () => {
    jest.spyOn(useNoteStore.persist, 'hasHydrated').mockReturnValue(true)
    jest.spyOn(useFolderStore.persist, 'hasHydrated').mockReturnValue(true)

    const { result } = renderHook(() => useStoresHydrated())
    expect(result.current).toBe(true)
  })

  test('flips to true only after the SECOND store finishes hydrating', () => {
    let notesHydrated = false
    let foldersHydrated = false
    let notesCb: (() => void) | undefined
    let foldersCb: (() => void) | undefined

    jest.spyOn(useNoteStore.persist, 'hasHydrated').mockImplementation(() => notesHydrated)
    jest.spyOn(useFolderStore.persist, 'hasHydrated').mockImplementation(() => foldersHydrated)
    jest.spyOn(useNoteStore.persist, 'onFinishHydration').mockImplementation((cb) => {
      notesCb = cb as () => void
      return () => {}
    })
    jest.spyOn(useFolderStore.persist, 'onFinishHydration').mockImplementation((cb) => {
      foldersCb = cb as () => void
      return () => {}
    })

    const { result } = renderHook(() => useStoresHydrated())
    expect(result.current).toBe(false)

    // Notes finish first — still false because folders haven't.
    act(() => {
      notesHydrated = true
      notesCb?.()
    })
    expect(result.current).toBe(false)

    // Folders finish — now both are hydrated.
    act(() => {
      foldersHydrated = true
      foldersCb?.()
    })
    expect(result.current).toBe(true)
  })

  test('unsubscribes from both stores on unmount', () => {
    jest.spyOn(useNoteStore.persist, 'hasHydrated').mockReturnValue(false)
    jest.spyOn(useFolderStore.persist, 'hasHydrated').mockReturnValue(false)
    const unsubNotes = jest.fn()
    const unsubFolders = jest.fn()
    jest.spyOn(useNoteStore.persist, 'onFinishHydration').mockReturnValue(unsubNotes)
    jest.spyOn(useFolderStore.persist, 'onFinishHydration').mockReturnValue(unsubFolders)

    const { unmount } = renderHook(() => useStoresHydrated())
    unmount()
    expect(unsubNotes).toHaveBeenCalledTimes(1)
    expect(unsubFolders).toHaveBeenCalledTimes(1)
  })
})
