/**
 * aiCommitMessage.test.ts
 *
 * Verifies the AI-drafted commit-message helper:
 *   - Returns null when no pending changes exist.
 *   - Calls runPrompt with a summary that includes the pending
 *     changes (no note bodies, just titles + paths).
 *   - Sanitises the model output: strips wrapping quotes, trailing
 *     punctuation, multiple lines, leading/trailing whitespace.
 *   - Swallows errors and returns null so the caller falls back.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

const runPromptMock = jest.fn()
jest.mock('../utils/aiClient', () => {
  const actual = jest.requireActual('../utils/aiClient')
  return {
    ...actual,
    runPrompt: (...args: unknown[]) => runPromptMock(...args),
  }
})

import { draftAiCommitMessage } from '../utils/aiCommitMessage'
import { useNoteStore } from '../stores/noteStore'
import { useGitHubStore } from '../stores/githubStore'

beforeEach(() => {
  runPromptMock.mockReset()
  useNoteStore.setState({ notes: [], selectedNoteId: null })
  useGitHubStore.setState({
    token: null, user: null, syncRepo: null, lastSyncedAt: null,
    lastCommitSha: null, isSyncing: false, connectedAt: null,
  } as Parameters<typeof useGitHubStore.setState>[0])
})

const fakeNote = (overrides: { id: string; title: string; gitPath?: string | null; updatedAt?: number; isDeleted?: boolean }) => ({
  id: overrides.id,
  title: overrides.title,
  content: 'body',
  folderId: null,
  createdAt: 0,
  updatedAt: overrides.updatedAt ?? 1,
  isDeleted: overrides.isDeleted ?? false,
  deletedAt: null,
  isPinned: false,
  templateId: null,
  gitPath: overrides.gitPath ?? null,
  gitLastPushedSha: null,
})

test('returns null when no pending changes exist', async () => {
  // Empty store → totalPendingCount returns 0.
  const result = await draftAiCommitMessage()
  expect(result).toBeNull()
  expect(runPromptMock).not.toHaveBeenCalled()
})

test('passes the change summary to runPrompt + returns the (sanitised) reply', async () => {
  useNoteStore.setState({
    notes: [
      fakeNote({ id: 'a', title: 'New plan', updatedAt: 5 }),
      fakeNote({ id: 'b', title: 'Old work',  gitPath: 'work/old.md', updatedAt: 5 }),
    ],
    selectedNoteId: null,
  })
  runPromptMock.mockResolvedValueOnce('Add new plan + update work notes.')

  const result = await draftAiCommitMessage()
  expect(result).toBe('Add new plan + update work notes')

  const call = runPromptMock.mock.calls[0][0]
  expect(call.system).toMatch(/commit messages/i)
  expect(call.messages[0].content).toContain('New plan')
  expect(call.messages[0].content).toContain('Old work')
})

test('strips wrapping quotes from the model output', async () => {
  useNoteStore.setState({
    notes: [fakeNote({ id: 'a', title: 'meeting', updatedAt: 5 })],
    selectedNoteId: null,
  })
  runPromptMock.mockResolvedValueOnce('"Add meeting notes"')
  expect(await draftAiCommitMessage()).toBe('Add meeting notes')
})

test('keeps only the first non-empty line of a multi-line reply', async () => {
  useNoteStore.setState({
    notes: [fakeNote({ id: 'a', title: 'x', updatedAt: 5 })],
    selectedNoteId: null,
  })
  runPromptMock.mockResolvedValueOnce('Headline message\n\nLonger description here.')
  expect(await draftAiCommitMessage()).toBe('Headline message')
})

test('returns null on runPrompt failure (fallback path)', async () => {
  useNoteStore.setState({
    notes: [fakeNote({ id: 'a', title: 'x', updatedAt: 5 })],
    selectedNoteId: null,
  })
  runPromptMock.mockRejectedValueOnce(new Error('quota exceeded'))
  expect(await draftAiCommitMessage()).toBeNull()
})

test('returns null when the model replies with whitespace', async () => {
  useNoteStore.setState({
    notes: [fakeNote({ id: 'a', title: 'x', updatedAt: 5 })],
    selectedNoteId: null,
  })
  runPromptMock.mockResolvedValueOnce('   \n\n  ')
  expect(await draftAiCommitMessage()).toBeNull()
})
