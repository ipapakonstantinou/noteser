/**
 * runNoteAIAction.test.ts
 *
 * Covers the dispatcher that powers both the right-click menu and the
 * command palette. Mocks aiClient.runPrompt so the test asserts on the
 * orchestration (modal opens, result lands, error path closes the
 * modal + surfaces a message) without hitting the network.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

// Mock the AI client. Each test sets the resolved/rejected value via
// runPromptMock.mockResolvedValueOnce / .mockRejectedValueOnce.
const runPromptMock = jest.fn()
jest.mock('../utils/aiClient', () => {
  const actual = jest.requireActual('../utils/aiClient')
  return {
    ...actual,
    runPrompt: (...args: unknown[]) => runPromptMock(...args),
  }
})

import { runNoteAIAction } from '../utils/runNoteAIAction'
import { useNoteStore } from '../stores/noteStore'
import { useUIStore } from '../stores/uiStore'
import { AIClientError } from '../utils/aiClient'

const alertMock = jest.fn()

beforeEach(() => {
  runPromptMock.mockReset()
  alertMock.mockReset()
  ;(globalThis as { alert: (msg: string) => void }).alert = alertMock
  useNoteStore.setState({
    notes: [
      { id: 'n1', title: 'Meeting', content: 'do X. do Y.', folderId: null,
        createdAt: 0, updatedAt: 0, isDeleted: false, deletedAt: null,
        isPinned: false, templateId: null },
    ],
    selectedNoteId: null,
  })
  useUIStore.setState({ modal: { type: null } })
})

test('opens the modal in "running" state, then re-opens with the result', async () => {
  runPromptMock.mockResolvedValueOnce('A short summary.')

  await runNoteAIAction({ actionId: 'summarize', noteId: 'n1' })

  expect(runPromptMock).toHaveBeenCalledTimes(1)
  const modal = useUIStore.getState().modal
  expect(modal.type).toBe('ai-result')
  expect(modal.data?.resultText).toBe('A short summary.')
  expect(modal.data?.actionLabel).toBe('Summarize note')
})

test('runs the right system prompt for each action', async () => {
  runPromptMock.mockResolvedValueOnce('')
  await runNoteAIAction({ actionId: 'extractTasks', noteId: 'n1' })
  const args = runPromptMock.mock.calls[0][0] as { system: string; messages: { role: string; content: string }[] }
  expect(args.system).toMatch(/task list/i)
  expect(args.messages[0].content).toMatch(/do X/)
})

test('translate passes the extra input into the user message', async () => {
  runPromptMock.mockResolvedValueOnce('')
  await runNoteAIAction({ actionId: 'translate', noteId: 'n1', extraInput: 'French' })
  const args = runPromptMock.mock.calls[0][0] as { messages: { content: string }[] }
  expect(args.messages[0].content.toLowerCase()).toContain('french')
})

test('AIClientError closes the modal and surfaces the message via alert()', async () => {
  runPromptMock.mockRejectedValueOnce(new AIClientError('No API key configured.'))

  await runNoteAIAction({ actionId: 'summarize', noteId: 'n1' })

  expect(alertMock).toHaveBeenCalledWith('No API key configured.')
  expect(useUIStore.getState().modal.type).toBeNull()
})

test('does not re-open the modal if the user closed it while the request was in flight', async () => {
  // Resolve runPrompt asynchronously after the test pre-closes the modal.
  let resolveCall: (v: string) => void = () => {}
  runPromptMock.mockReturnValueOnce(new Promise<string>((res) => { resolveCall = res }))

  const promise = runNoteAIAction({ actionId: 'summarize', noteId: 'n1' })
  // While in flight: modal should be open in "running" state.
  expect(useUIStore.getState().modal.type).toBe('ai-result')
  // User closes it.
  useUIStore.setState({ modal: { type: null } })
  // Provider eventually responds.
  resolveCall('belated summary')
  await promise

  // The dispatcher must NOT re-open the modal — that would be jarring.
  expect(useUIStore.getState().modal.type).toBeNull()
})

test('refuses to stack two runs for the same (note, action) pair', async () => {
  // Slow first call so the second is still in-flight when it fires.
  let resolveFirst: (v: string) => void = () => {}
  runPromptMock.mockReturnValueOnce(new Promise<string>((res) => { resolveFirst = res }))

  const first = runNoteAIAction({ actionId: 'summarize', noteId: 'n1' })
  // Second call (same key) should be a no-op while first is in-flight.
  await runNoteAIAction({ actionId: 'summarize', noteId: 'n1' })
  expect(runPromptMock).toHaveBeenCalledTimes(1)

  resolveFirst('ok')
  await first
})

test('different actions on the same note run independently', async () => {
  runPromptMock.mockResolvedValueOnce('summary')
  await runNoteAIAction({ actionId: 'summarize', noteId: 'n1' })
  runPromptMock.mockResolvedValueOnce('tasks')
  await runNoteAIAction({ actionId: 'extractTasks', noteId: 'n1' })
  expect(runPromptMock).toHaveBeenCalledTimes(2)
})

test('unknown action id is a silent no-op', async () => {
  await runNoteAIAction({ actionId: 'bogus' as 'summarize', noteId: 'n1' })
  expect(runPromptMock).not.toHaveBeenCalled()
  expect(useUIStore.getState().modal.type).toBeNull()
})

test('unknown note id is a silent no-op', async () => {
  await runNoteAIAction({ actionId: 'summarize', noteId: 'does-not-exist' })
  expect(runPromptMock).not.toHaveBeenCalled()
  expect(useUIStore.getState().modal.type).toBeNull()
})
