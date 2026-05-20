/**
 * aiActions.test.ts
 *
 * Validates the action registry + system-prompt + buildUserMessage
 * contracts. The action dispatcher itself is exercised via the
 * runNoteAIAction tests; here we just make sure each action has the
 * shape callers depend on.
 */

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
}))

import { AI_ACTIONS, getAIAction, type AIActionId } from '../utils/aiActions'
import type { Note } from '../types'

function note(content: string): Note {
  return {
    id: 'n1',
    title: 'T',
    content,
    folderId: null,
    createdAt: 0,
    updatedAt: 0,
    isDeleted: false,
    deletedAt: null,
    isPinned: false,
    templateId: null,
  } as Note
}

test('AI_ACTIONS has exactly the 5 documented ids', () => {
  const ids = AI_ACTIONS.map(a => a.id).sort()
  expect(ids).toEqual([
    'extractTasks', 'rewriteClarity', 'suggestTags', 'summarize', 'translate',
  ])
})

test('every action has a non-empty system prompt + label', () => {
  for (const a of AI_ACTIONS) {
    expect(a.label.length).toBeGreaterThan(0)
    expect(a.systemPrompt.length).toBeGreaterThan(20) // sanity: not blank
  }
})

test('only translate declares needsExtraInput', () => {
  const needsInput = AI_ACTIONS.filter(a => a.needsExtraInput).map(a => a.id)
  expect(needsInput).toEqual(['translate'])
})

test('compare-mode actions are rewriteClarity + translate', () => {
  const compare = AI_ACTIONS.filter(a => a.display === 'compare').map(a => a.id).sort()
  expect(compare).toEqual(['rewriteClarity', 'translate'])
})

test('buildUserMessage embeds the note content', () => {
  for (const a of AI_ACTIONS) {
    const msg = a.buildUserMessage(note('hello world'), 'Spanish')
    expect(msg).toContain('hello world')
  }
})

test('translate buildUserMessage includes the target language', () => {
  const action = getAIAction('translate')!
  const msg = action.buildUserMessage(note('content'), 'Japanese')
  expect(msg.toLowerCase()).toContain('japanese')
})

test('translate falls back to English when no target provided', () => {
  const action = getAIAction('translate')!
  const msg = action.buildUserMessage(note('content'))
  expect(msg.toLowerCase()).toContain('english')
})

test('getAIAction returns undefined for unknown ids', () => {
  expect(getAIAction('nope' as AIActionId)).toBeUndefined()
})
