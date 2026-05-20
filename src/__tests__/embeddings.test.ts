/**
 * embeddings.test.ts
 *
 * Pure-helper tests for the embeddings utilities (a1f7). Network calls
 * (embedText, IDB writes) are exercised separately via runNoteAIAction
 * patterns — here we just lock in the math + the input shaping.
 */

jest.mock('idb-keyval', () => {
  // Tiny in-memory shim so the IDB-backed helpers exercise their real
  // wiring without a browser env. Tests that touch storage import the
  // module fresh via jest.isolateModules where needed.
  const store = new Map<string, unknown>()
  return {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => { store.set(k, v) }),
    del: jest.fn(async (k: string) => { store.delete(k) }),
    keys: jest.fn(async () => Array.from(store.keys())),
    __store: store,
  }
})

import {
  cosineSimilarity,
  topRelated,
  buildEmbedInput,
  hashContent,
  type NoteEmbedding,
} from '../utils/embeddings'

test('cosineSimilarity returns 1 for identical vectors', () => {
  expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6)
  expect(cosineSimilarity([2, 3, 4], [2, 3, 4])).toBeCloseTo(1, 6)
})

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0)
})

test('cosineSimilarity returns -1 for opposite vectors', () => {
  expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6)
})

test('cosineSimilarity returns 0 for any-zero-norm input (no NaN)', () => {
  expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  expect(cosineSimilarity([], [1, 2, 3])).toBe(0)
  expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0) // length mismatch
})

test('topRelated ranks by descending similarity', () => {
  const candidates: NoteEmbedding[] = [
    { noteId: 'a', vector: [1, 0, 0], contentHash: 'h', embeddedAt: 0 },
    { noteId: 'b', vector: [0.9, 0.1, 0], contentHash: 'h', embeddedAt: 0 },
    { noteId: 'c', vector: [0.5, 0.5, 0], contentHash: 'h', embeddedAt: 0 },
  ]
  const target = [1, 0, 0]
  const out = topRelated(target, candidates, 'a', 5)
  // 'a' excluded; 'b' before 'c' because it points more directly
  // along the target axis.
  expect(out.map(r => r.noteId)).toEqual(['b', 'c'])
})

test('topRelated drops the target itself + zero-score candidates', () => {
  const candidates: NoteEmbedding[] = [
    { noteId: 'self', vector: [1, 0], contentHash: 'h', embeddedAt: 0 },
    { noteId: 'orth', vector: [0, 1], contentHash: 'h', embeddedAt: 0 }, // score 0
    { noteId: 'good', vector: [0.5, 0.5], contentHash: 'h', embeddedAt: 0 },
  ]
  const target = [1, 0]
  const out = topRelated(target, candidates, 'self', 5)
  expect(out.map(r => r.noteId)).toEqual(['good'])
})

test('topRelated obeys the limit', () => {
  const candidates: NoteEmbedding[] = []
  for (let i = 0; i < 10; i++) {
    candidates.push({
      noteId: `n${i}`,
      vector: [Math.cos(i * 0.05), Math.sin(i * 0.05)],
      contentHash: 'h',
      embeddedAt: 0,
    })
  }
  const target = [1, 0]
  const out = topRelated(target, candidates, 'never-matches', 3)
  expect(out).toHaveLength(3)
})

test('buildEmbedInput prefixes the title above the body', () => {
  const result = buildEmbedInput({ title: 'My note', content: 'body text' })
  expect(result.startsWith('My note')).toBe(true)
  expect(result).toContain('body text')
})

test('buildEmbedInput skips the title when blank', () => {
  expect(buildEmbedInput({ title: '', content: 'only body' })).toBe('only body')
  expect(buildEmbedInput({ title: '   ', content: 'only body' })).toBe('only body')
})

test('buildEmbedInput truncates very large input', () => {
  const big = 'x'.repeat(20_000)
  const out = buildEmbedInput({ title: '', content: big })
  expect(out.length).toBeLessThanOrEqual(8_000)
})

test('hashContent is deterministic and differs on change', () => {
  expect(hashContent('hello')).toBe(hashContent('hello'))
  expect(hashContent('hello')).not.toBe(hashContent('hellp'))
})
