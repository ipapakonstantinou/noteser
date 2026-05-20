/**
 * useAutoEmbedNotes.test.tsx
 *
 * Verifies the debounced auto-embedding hook (a1f7 phase B):
 *   - No call when the feature is off, even on note edits.
 *   - No call when provider isn't OpenAI or no key configured.
 *   - One call per (note, debounce-window) after a content change.
 *   - Rapid edits coalesce into a single trailing call.
 *   - Soft-deletes drop the tracking entry without firing.
 *   - Errors are swallowed (don't crash future calls).
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  keys: jest.fn().mockResolvedValue([]),
}))

const indexNoteMock = jest.fn().mockResolvedValue(null)
jest.mock('../utils/embeddings', () => {
  const actual = jest.requireActual('../utils/embeddings')
  return {
    ...actual,
    indexNote: (...args: unknown[]) => indexNoteMock(...args),
  }
})

import React from 'react'
import { render, act } from '@testing-library/react'
import { useAutoEmbedNotes } from '../hooks/useAutoEmbedNotes'
import { useNoteStore } from '../stores/noteStore'
import { useSettingsStore } from '../stores/settingsStore'

function Harness() {
  useAutoEmbedNotes()
  return null
}

function makeNote(id: string, content = 'body'): Parameters<typeof useNoteStore.setState>[0] extends infer S
  ? S extends { notes: infer N } ? N extends Array<infer T> ? T : never : never : never {
  return {
    id, title: `t-${id}`, content, folderId: null,
    createdAt: 0, updatedAt: 0, isDeleted: false, deletedAt: null,
    isPinned: false, templateId: null,
  } as never
}

beforeEach(() => {
  jest.useFakeTimers()
  indexNoteMock.mockClear()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useSettingsStore.setState({
    aiEmbeddingsEnabled: true,
    aiProvider: 'openai',
    aiApiKey: 'sk-test',
  })
})

afterEach(() => {
  jest.useRealTimers()
})

test('no call when aiEmbeddingsEnabled is false, even on content change', () => {
  useSettingsStore.setState({ aiEmbeddingsEnabled: false })
  useNoteStore.setState({ notes: [makeNote('n1', 'before')], selectedNoteId: null })
  render(<Harness />)

  act(() => {
    useNoteStore.setState({ notes: [makeNote('n1', 'after edit')], selectedNoteId: null })
  })
  act(() => { jest.runAllTimers() })
  expect(indexNoteMock).not.toHaveBeenCalled()
})

test('no call when aiProvider is not openai', () => {
  useSettingsStore.setState({ aiProvider: 'anthropic' })
  useNoteStore.setState({ notes: [makeNote('n1', 'before')], selectedNoteId: null })
  render(<Harness />)

  act(() => {
    useNoteStore.setState({ notes: [makeNote('n1', 'after edit')], selectedNoteId: null })
  })
  act(() => { jest.runAllTimers() })
  expect(indexNoteMock).not.toHaveBeenCalled()
})

test('content change triggers indexNote once after the debounce window', () => {
  useNoteStore.setState({ notes: [makeNote('n1', 'before')], selectedNoteId: null })
  render(<Harness />)

  act(() => {
    useNoteStore.setState({ notes: [makeNote('n1', 'after')], selectedNoteId: null })
  })
  expect(indexNoteMock).not.toHaveBeenCalled() // still in debounce window
  act(() => { jest.advanceTimersByTime(5000) })
  expect(indexNoteMock).toHaveBeenCalledTimes(1)
  expect((indexNoteMock.mock.calls[0][0] as { id: string }).id).toBe('n1')
})

test('rapid edits coalesce into a single trailing call', () => {
  useNoteStore.setState({ notes: [makeNote('n1', 'v0')], selectedNoteId: null })
  render(<Harness />)

  act(() => {
    useNoteStore.setState({ notes: [makeNote('n1', 'v1')], selectedNoteId: null })
    jest.advanceTimersByTime(1000)
    useNoteStore.setState({ notes: [makeNote('n1', 'v2')], selectedNoteId: null })
    jest.advanceTimersByTime(1000)
    useNoteStore.setState({ notes: [makeNote('n1', 'v3')], selectedNoteId: null })
    jest.advanceTimersByTime(5000)
  })
  expect(indexNoteMock).toHaveBeenCalledTimes(1)
  // The final call should see the LATEST content (v3) — the hook
  // re-reads the store at fire time, not the captured snapshot.
  expect((indexNoteMock.mock.calls[0][0] as { content: string }).content).toBe('v3')
})

test('soft-delete drops the tracking entry without firing', () => {
  useNoteStore.setState({ notes: [makeNote('n1', 'v0')], selectedNoteId: null })
  render(<Harness />)

  // Soft-delete the note.
  act(() => {
    useNoteStore.setState({
      notes: [{ ...makeNote('n1', 'v0'), isDeleted: true } as never],
      selectedNoteId: null,
    })
    jest.advanceTimersByTime(5000)
  })
  expect(indexNoteMock).not.toHaveBeenCalled()
})

test('seeded hash means the initial subscribe tick does not fire embeds', () => {
  // Pre-populate the store BEFORE the hook mounts.
  useNoteStore.setState({ notes: [makeNote('n1', 'unchanged')], selectedNoteId: null })
  render(<Harness />)
  // Trigger the subscriber by setting the SAME state again.
  act(() => {
    useNoteStore.setState({ notes: [makeNote('n1', 'unchanged')], selectedNoteId: null })
    jest.advanceTimersByTime(5000)
  })
  expect(indexNoteMock).not.toHaveBeenCalled()
})

test('two notes edited in succession each schedule independent timers', () => {
  useNoteStore.setState({
    notes: [makeNote('n1', 'a0'), makeNote('n2', 'b0')],
    selectedNoteId: null,
  })
  render(<Harness />)

  act(() => {
    useNoteStore.setState({
      notes: [makeNote('n1', 'a1'), makeNote('n2', 'b0')],
      selectedNoteId: null,
    })
  })
  act(() => {
    useNoteStore.setState({
      notes: [makeNote('n1', 'a1'), makeNote('n2', 'b1')],
      selectedNoteId: null,
    })
  })
  act(() => { jest.advanceTimersByTime(5000) })

  expect(indexNoteMock).toHaveBeenCalledTimes(2)
  const ids = indexNoteMock.mock.calls.map(c => (c[0] as { id: string }).id).sort()
  expect(ids).toEqual(['n1', 'n2'])
})

test('indexNote errors are swallowed (future runs continue)', async () => {
  indexNoteMock.mockRejectedValueOnce(new Error('boom'))
  useNoteStore.setState({ notes: [makeNote('n1', 'v0')], selectedNoteId: null })
  render(<Harness />)

  act(() => {
    useNoteStore.setState({ notes: [makeNote('n1', 'v1')], selectedNoteId: null })
    jest.advanceTimersByTime(5000)
  })
  // Wait the microtask queue so the rejection runs through.
  await act(async () => { await Promise.resolve() })

  // Now another edit should still schedule + fire.
  act(() => {
    useNoteStore.setState({ notes: [makeNote('n1', 'v2')], selectedNoteId: null })
    jest.advanceTimersByTime(5000)
  })
  expect(indexNoteMock).toHaveBeenCalledTimes(2)
})
