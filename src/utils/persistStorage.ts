// Explicit localStorage-backed Zustand persist storage with a safe
// non-browser fallback (issue #131).
//
// Zustand's persist default is `createJSONStorage(() => window.localStorage)`.
// Where `window` does not exist — SSR imports of the stores, and Jest suites
// marked `@jest-environment node` — that getter throws, the middleware ends
// up with NO storage at all, and every subsequent `set()` logs
//   [zustand persist middleware] Unable to update item '…',
//   the given storage is currently unavailable.
// (~70 such warnings across the unit-test run before this existed.)
//
// Persistence is meaningless off-browser anyway, so fall back to a throwaway
// in-memory Map: a *working* storage keeps the middleware silent without
// changing browser behaviour one bit. The branch is taken once, at module
// evaluation, so the browser path is exactly zustand's default.
import { createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'

const memory = new Map<string, string>()

const memoryBackend: StateStorage = {
  getItem: (name) => memory.get(name) ?? null,
  setItem: (name, value) => {
    memory.set(name, value)
  },
  removeItem: (name) => {
    memory.delete(name)
  },
}

/**
 * Drop-in for the persist middleware's implicit default. Use this on every
 * store that persists to localStorage (the IndexedDB-backed stores use
 * `idbStorage` from `@/utils/idbStorage` instead).
 */
export const localStorageJSON = createJSONStorage(() =>
  typeof window === 'undefined' ? memoryBackend : window.localStorage,
)
