import { sortNotes } from '../utils/sortNotes'
import type { Note } from '../types'

function makeNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    title: overrides.title ?? '',
    content: '',
    folderId: null,
    createdAt: overrides.createdAt ?? 0,
    updatedAt: overrides.updatedAt ?? 0,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
  }
}

describe('sortNotes', () => {
  const a = makeNote({ id: 'a', title: 'Apple',  createdAt: 100, updatedAt: 300 })
  const b = makeNote({ id: 'b', title: 'banana', createdAt: 200, updatedAt: 100 })
  const c = makeNote({ id: 'c', title: 'cherry', createdAt: 50,  updatedAt: 200 })
  const insertionOrder = [b, a, c]

  test('manual returns the input array reference unchanged', () => {
    expect(sortNotes(insertionOrder, 'manual')).toBe(insertionOrder)
  })

  test('alphabetical sorts by title case-insensitively (A, b, c)', () => {
    const result = sortNotes(insertionOrder, 'alphabetical')
    expect(result.map(n => n.id)).toEqual(['a', 'b', 'c'])
  })

  test('modified sorts by updatedAt descending (newest first)', () => {
    const result = sortNotes(insertionOrder, 'modified')
    expect(result.map(n => n.id)).toEqual(['a', 'c', 'b'])  // 300, 200, 100
  })

  test('created sorts by createdAt descending (newest first)', () => {
    const result = sortNotes(insertionOrder, 'created')
    expect(result.map(n => n.id)).toEqual(['b', 'a', 'c'])  // 200, 100, 50
  })

  test('does not mutate the input array (non-manual modes)', () => {
    const input = [b, a, c]
    const before = input.map(n => n.id)
    sortNotes(input, 'alphabetical')
    sortNotes(input, 'modified')
    sortNotes(input, 'created')
    expect(input.map(n => n.id)).toEqual(before)
  })

  test('empty array returns []', () => {
    expect(sortNotes([], 'alphabetical')).toEqual([])
    expect(sortNotes([], 'manual')).toEqual([])
  })

  test('single-element array sorts to itself', () => {
    expect(sortNotes([a], 'alphabetical')).toEqual([a])
    expect(sortNotes([a], 'modified')).toEqual([a])
  })
})
