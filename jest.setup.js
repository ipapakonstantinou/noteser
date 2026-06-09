import '@testing-library/jest-dom'

// jsdom doesn't ship TextEncoder/TextDecoder globally — code that uses
// them (shareLink, embeds, etc) needs them present in the test env.
import { TextEncoder, TextDecoder } from 'util'
if (!global.TextEncoder) global.TextEncoder = TextEncoder
if (!global.TextDecoder) global.TextDecoder = TextDecoder

// jsdom drops Response/Headers/Request — Node 18+ has them on globalThis
// natively (via undici, but as built-ins), so we restore them here. We
// intentionally do NOT polyfill global.fetch — tests that need it
// jest.fn() it explicitly so mocks are unambiguous.
if (typeof global.Response === 'undefined' && typeof globalThis.Response !== 'undefined') {
  global.Response = globalThis.Response
  global.Headers = globalThis.Headers
  global.Request = globalThis.Request
}

// Zustand's persist middleware logs a `console.warn` every time a
// hydrated store writes back to a missing storage. jsdom doesn't expose
// localStorage to Zustand's createJSONStorage (it returns undefined when
// the storage probe runs before the test environment is ready), so each
// store fires the warning on every `set()` — ~70 lines per test run.
// Filter only that exact category; every other warning passes through.
const PERSIST_WARNING_RE = /\[zustand persist middleware\] Unable to update item .*storage is currently unavailable/
const originalConsoleWarn = console.warn
console.warn = (...args) => {
  const first = args[0]
  if (typeof first === 'string' && PERSIST_WARNING_RE.test(first)) return
  originalConsoleWarn(...args)
}
