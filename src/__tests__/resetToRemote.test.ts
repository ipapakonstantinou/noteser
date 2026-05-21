/**
 * resetToRemote unit tests.
 *
 * Verifies the local-wipe strategy:
 *   - preserveUnpushed=true (default): drop pushed notes, keep
 *     local-only notes.
 *   - preserveUnpushed=false: nuke everything.
 *   - selectedNoteId is cleared when the selection no longer exists.
 *   - selectedNoteId is preserved when the selection survives the wipe.
 */

import { useNoteStore } from '../stores/noteStore'
import { resetToRemote } from '../utils/resetToRemote'
import type { Note } from '@/types'

function makeNote(id: string, opts: Partial<Note> = {}): Note {
  return {
    id, title: id, content: '', folderId: null,
    createdAt: 0, updatedAt: 0, isDeleted: false, deletedAt: null,
    isPinned: false, templateId: null,
    gitPath: null, gitLastPushedSha: null,
    ...opts,
  }
}

function seed(notes: Note[], selectedNoteId: string | null = null): void {
  useNoteStore.setState({ notes, selectedNoteId })
}

describe('resetToRemote', () => {
  test('default: drops pushed notes, preserves unpushed', () => {
    seed([
      makeNote('a', { gitPath: 'A.md' }),
      makeNote('b', { gitPath: 'B.md' }),
      makeNote('c', { gitPath: null }),
    ])
    const result = resetToRemote()
    expect(result).toEqual({ pushedDropped: 2, unpushedDropped: 0, preserved: 1 })
    const remaining = useNoteStore.getState().notes.map(n => n.id)
    expect(remaining).toEqual(['c'])
  })

  test('preserveUnpushed=false drops everything', () => {
    seed([
      makeNote('a', { gitPath: 'A.md' }),
      makeNote('b', { gitPath: null }),
    ])
    const result = resetToRemote({ preserveUnpushed: false })
    expect(result).toEqual({ pushedDropped: 1, unpushedDropped: 1, preserved: 0 })
    expect(useNoteStore.getState().notes).toEqual([])
  })

  test('clears selectedNoteId when selection was a pushed note', () => {
    seed([
      makeNote('a', { gitPath: 'A.md' }),
      makeNote('b', { gitPath: null }),
    ], 'a')
    resetToRemote()
    expect(useNoteStore.getState().selectedNoteId).toBeNull()
  })

  test('preserves selectedNoteId when selection survives', () => {
    seed([
      makeNote('a', { gitPath: 'A.md' }),
      makeNote('b', { gitPath: null }),
    ], 'b')
    resetToRemote()
    expect(useNoteStore.getState().selectedNoteId).toBe('b')
  })

  test('empty vault: no-op result', () => {
    seed([])
    const result = resetToRemote()
    expect(result).toEqual({ pushedDropped: 0, unpushedDropped: 0, preserved: 0 })
  })
})
