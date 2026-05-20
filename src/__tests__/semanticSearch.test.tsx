/**
 * semanticSearch.test.tsx
 *
 * Verifies the semantic-search mode in SearchModal (a1f7 phase C):
 *   - Toggle is disabled when embeddings prerequisites aren't met.
 *   - Switching to semantic mode + typing fires embedText with the
 *     query and lists the top-K cosine matches.
 *   - Errors from embedText surface inline (no modal pop).
 *   - When semantic finds no cached vectors, the user sees the
 *     "no notes indexed" hint pointing to Settings → AI.
 */

jest.mock('idb-keyval', () => {
  const store = new Map<string, unknown>()
  return {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => { store.set(k, v) }),
    del: jest.fn(async (k: string) => { store.delete(k) }),
    keys: jest.fn(async () => Array.from(store.keys())),
    __store: store,
  }
})

const embedTextMock = jest.fn()
jest.mock('../utils/aiClient', () => {
  const actual = jest.requireActual('../utils/aiClient')
  return {
    ...actual,
    embedText: (...args: unknown[]) => embedTextMock(...args),
  }
})

import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SearchModal } from '../components/modals/SearchModal'
import { useUIStore } from '../stores/uiStore'
import { useNoteStore } from '../stores/noteStore'
import { useSettingsStore } from '../stores/settingsStore'
import { saveEmbedding, clearAllEmbeddings } from '../utils/embeddings'

const note = (id: string, title: string, content = '') => ({
  id, title, content, folderId: null,
  createdAt: 0, updatedAt: 0,
  isDeleted: false, deletedAt: null,
  isPinned: false, templateId: null,
  gitPath: null, gitLastPushedSha: null,
})

beforeEach(async () => {
  embedTextMock.mockReset()
  await clearAllEmbeddings()
  useUIStore.setState({ isSearchOpen: true, searchQuery: '' })
  useNoteStore.setState({
    notes: [
      note('n1', 'Apple pie recipe', 'flour butter sugar apples'),
      note('n2', 'Travel to Paris', 'eiffel tower croissants'),
      note('n3', 'Quarterly review', 'revenue growth retention'),
    ],
    selectedNoteId: null,
  })
  useSettingsStore.setState({
    aiEmbeddingsEnabled: false,
    aiProvider: 'off',
    aiApiKey: '',
  })
})

test('semantic toggle is disabled when embeddings prerequisites are not met', () => {
  render(<SearchModal />)
  const semantic = screen.getByTestId('search-mode-semantic')
  expect(semantic).toBeDisabled()
})

test('semantic toggle becomes enabled when embeddings + openai + key are set', () => {
  useSettingsStore.setState({
    aiEmbeddingsEnabled: true, aiProvider: 'openai', aiApiKey: 'sk-test',
  })
  render(<SearchModal />)
  const semantic = screen.getByTestId('search-mode-semantic')
  expect(semantic).not.toBeDisabled()
})

test('semantic mode + typed query embeds + ranks by cosine; top hit is returned', async () => {
  useSettingsStore.setState({
    aiEmbeddingsEnabled: true, aiProvider: 'openai', aiApiKey: 'sk-test',
  })
  // Seed two note embeddings: n2 (Paris) much closer to the query vec.
  await saveEmbedding({ noteId: 'n1', vector: [0, 1], contentHash: 'h', embeddedAt: 0 })
  await saveEmbedding({ noteId: 'n2', vector: [1, 0], contentHash: 'h', embeddedAt: 0 })
  embedTextMock.mockResolvedValueOnce([1, 0]) // query aligns with n2

  render(<SearchModal />)
  fireEvent.click(screen.getByTestId('search-mode-semantic'))
  fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'travel' } })

  // 400ms debounce + microtask drain.
  await act(async () => {
    await new Promise(res => setTimeout(res, 450))
  })

  expect(embedTextMock).toHaveBeenCalledWith({ text: 'travel' })
  // n2 ranks first.
  const buttons = screen.getAllByRole('button')
    .filter(b => b.getAttribute('data-index') != null)
  expect(buttons.length).toBeGreaterThan(0)
  expect(buttons[0].textContent).toContain('Travel to Paris')
})

test('semantic search shows the "no notes indexed" hint when cache is empty', async () => {
  useSettingsStore.setState({
    aiEmbeddingsEnabled: true, aiProvider: 'openai', aiApiKey: 'sk-test',
  })
  // No embeddings saved.
  embedTextMock.mockResolvedValueOnce([1, 0])

  render(<SearchModal />)
  fireEvent.click(screen.getByTestId('search-mode-semantic'))
  fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'anything' } })

  await act(async () => {
    await new Promise(res => setTimeout(res, 450))
  })

  // The mode-bar error slot shows the hint pointing to Settings.
  expect(screen.getByText(/Index all notes/i)).toBeInTheDocument()
})

test('semantic search surfaces embed errors inline without crashing', async () => {
  useSettingsStore.setState({
    aiEmbeddingsEnabled: true, aiProvider: 'openai', aiApiKey: 'sk-test',
  })
  embedTextMock.mockRejectedValueOnce(new Error('rate limit'))

  render(<SearchModal />)
  fireEvent.click(screen.getByTestId('search-mode-semantic'))
  fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'anything' } })

  await act(async () => {
    await new Promise(res => setTimeout(res, 450))
  })

  expect(screen.getByText(/rate limit/i)).toBeInTheDocument()
})
