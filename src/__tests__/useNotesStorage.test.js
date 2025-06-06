import { renderHook, act } from '@testing-library/react'
import useNotesStorage from '../hooks/useNotesStorage'

// simple localStorage mock
let store

beforeEach(() => {
  store = {}
  jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(key => {
    return store[key] || null
  })
  jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation((key, value) => {
    store[key] = value
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

test('notes and folders are saved when updated including empty arrays', () => {
  const { result } = renderHook(() => useNotesStorage())

  // ignore initial effect calls
  window.localStorage.setItem.mockClear()

  act(() => {
    result.current.setNotes([{ id: 1, title: 'note' }])
  })
  expect(window.localStorage.setItem).toHaveBeenLastCalledWith(
    'notes',
    JSON.stringify([{ id: 1, title: 'note' }])
  )

  act(() => {
    result.current.setFolders([{ id: 1, name: 'folder' }])
  })
  expect(window.localStorage.setItem).toHaveBeenLastCalledWith(
    'folders',
    JSON.stringify([{ id: 1, name: 'folder' }])
  )

  window.localStorage.setItem.mockClear()
  act(() => {
    result.current.setNotes([])
  })
  expect(window.localStorage.setItem).toHaveBeenLastCalledWith('notes', '[]')

  window.localStorage.setItem.mockClear()
  act(() => {
    result.current.setFolders([])
  })
  expect(window.localStorage.setItem).toHaveBeenLastCalledWith('folders', '[]')
})

test('sidebarCollapsed persists correctly', () => {
  store.sidebarCollapsed = 'true'
  const { result } = renderHook(() => useNotesStorage())
  expect(result.current.sidebarCollapsed).toBe(true)

  window.localStorage.setItem.mockClear()
  act(() => {
    result.current.setSidebarCollapsed(false)
  })
  expect(window.localStorage.setItem).toHaveBeenCalledWith('sidebarCollapsed', false)
})
