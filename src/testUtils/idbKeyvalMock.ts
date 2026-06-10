// Shared in-memory `idb-keyval` mock for Jest suites (issue #131).
//
// Zustand's persist middleware writes through `idb-keyval` (via
// src/utils/idbStorage.ts) for the large stores. Tests must mock that
// boundary; the canonical Map-backed variant (originally inline in
// attachments.test.ts) round-trips get/set so save→read flows work,
// unlike the older no-op variant.
//
// Usage — the `jest.mock` factory is hoisted above imports, so reference
// the helper through `require` inside the factory. Use a RELATIVE
// specifier there: the SWC jest transformer only rewrites `@/` aliases in
// import statements, not in bare `require('@/…')` literals.
//
//   jest.mock('idb-keyval', () => require('../testUtils/idbKeyvalMock').idbKeyvalMock)
//   import { resetIdbKeyvalMock } from '../testUtils/idbKeyvalMock'
//   beforeEach(() => resetIdbKeyvalMock())
//
// `resetIdbKeyvalMock` clears both the backing Map and the jest.fn call
// history so suites stay order-independent (docs/testing.md rule 3).

const memory = new Map<string, unknown>()

export const idbKeyvalMock = {
  get: jest.fn((key: string) => Promise.resolve(memory.get(key))),
  set: jest.fn((key: string, value: unknown) => {
    memory.set(key, value)
    return Promise.resolve()
  }),
  del: jest.fn((key: string) => {
    memory.delete(key)
    return Promise.resolve()
  }),
  keys: jest.fn(() => Promise.resolve([...memory.keys()])),
}

/** Direct handle on the backing store, for seeding or asserting raw entries. */
export function getIdbKeyvalMemory(): Map<string, unknown> {
  return memory
}

/** Clear stored entries and jest.fn call history. Call from `beforeEach`. */
export function resetIdbKeyvalMock(): void {
  memory.clear()
  idbKeyvalMock.get.mockClear()
  idbKeyvalMock.set.mockClear()
  idbKeyvalMock.del.mockClear()
  idbKeyvalMock.keys.mockClear()
}
